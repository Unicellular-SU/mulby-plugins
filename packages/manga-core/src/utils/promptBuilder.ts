// ================= 场景引用解析与页 prompt 拼装（方案 7.4 步骤 3，纯函数） =================
// 从 App.tsx 机械搬移，prompt 字符串逐字节保持（模板字面量内部缩进不得改动）：
// - buildCoverPage / prepareScenePages：首轮批量绘制（prepareScenePages 含
//   persistent_states 的 [ACTION STATE OVERRIDE] 拼装）；
// - resolvePageRefs：单页重绘 / 续绘共用（无状态覆写——与 prepareScenePages 的差异
//   为既有行为，重构不偷改，方案 7.4 步骤 3 注记）。

import { resolveByName } from '@mulby-plugins/manga-kit';
import { CharacterSheetItem, PropSheetItem, SceneSheetItem, ComicPageData, ComicResponse, ComicPageScript } from '../engine-types';

/** Helper to find character reference image（统一名字解析口径，方案 2.4） */
export const getCharacterReference = (name: string, sheet: CharacterSheetItem[]): string | undefined => {
   return resolveByName(name, sheet)?.referenceImage;
};

// ---- 对白机械注入（方案 B：绑定确定性由引擎保证，不靠模型自觉） ----
// 每条 dialogue 生成一行与 Mandatory Format 同风格的绑定句；position 缺省回退文案。
// 注入块是页 prompt 的结尾段；重绘路径先剥离旧块再按当前 dialogue 重注（防重复）。

export const DIALOGUE_BLOCK_MARKER = '\n\nSPEECH BUBBLES (BINDING';

/** 逐条生成气泡绑定句；无有效对白返回空串 */
export const buildDialogueBlock = (dialogue?: ComicPageScript['dialogue']): string => {
  if (!dialogue || dialogue.length === 0) return '';
  const lines = dialogue
    .filter(d => d && d.speaker && d.text)
    .map(d => `Includes speech bubble located ${d.position?.trim() || 'a clear position near the speaker'} pointing to ${d.speaker} with text: '${d.text}'`);
  return lines.length > 0
    ? `${DIALOGUE_BLOCK_MARKER} — EXACTLY ONE CHARACTER PER BUBBLE):\n${lines.join('\n')}`
    : '';
};

/** 剥离已注入的对白块（重绘/续绘路径的 prompt 可能带着上次注入的块） */
const stripDialogueBlock = (prompt: string): string => {
  const idx = prompt.indexOf(DIALOGUE_BLOCK_MARKER);
  return idx >= 0 ? prompt.slice(0, idx) : prompt;
};

/** 封面页骨架与 cover prompt（从 handleStartComicGeneration 平移） */
export const buildCoverPage = (
    comicScript: ComicResponse,
    style: string,
    coverCharacters: string[]
): ComicPageData => {
    const coverPrompt = `Art Style: ${style} (Master Style). ${comicScript.cover_image_prompt}. Text in image must be Simplified Chinese: "${comicScript.title}". Masterpiece, Title Page.`;

    return {
      page_number: 0,
      layout_description: "Cover Art",
      title: comicScript.title,
      image_prompt: coverPrompt,
      characters_in_scene: coverCharacters,
      props_in_scene: [],
      isGenerating: true,
      persistent_states: { characters: [], environment: { lighting: 'default', notable_changes: [] } },
      state_changes_this_page: []
    };
};

/** PRE-CALCULATE PAGES：逐页解析参考图 + 拼装最终 prompt（从 handleStartComicGeneration 平移） */
export const prepareScenePages = (
    comicScript: ComicResponse,
    style: string,
    characterSheet: CharacterSheetItem[],
    propSheet: PropSheetItem[],
    sceneSheet: SceneSheetItem[] = []
): Array<{ pageData: ComicPageData; resolvedRefs: string[] }> => {
    return comicScript.pages.map(s => {
          const presentCharacters = s.characters_in_scene || [];
          const presentProps = s.props_in_scene || [];
          const presentScenes = s.scenes_in_scene || [];

          const sceneRefs: string[] = [];
          const characterContexts: string[] = [];

          // 1. Resolve Characters
          presentCharacters.forEach(name => {
              const charItem = resolveByName(name, characterSheet);

              if (charItem) {
                  if (charItem.referenceImage) {
                      sceneRefs.push(charItem.referenceImage);
                  }

                  const charState = s.persistent_states?.characters?.find(c => c.name === name || c.name === charItem.name);
                  let stateDescription = "";
                  if (charState?.state) {
                      const appearance = charState.state.appearance_changes?.join(", ");
                      const injuries = charState.state.injuries?.join(", ");
                      const states = [appearance, injuries].filter(x => x).join(", ");
                      if (states) stateDescription = `[ACTION STATE OVERRIDE: ${states}]`;
                  }

                  characterContexts.push(`Identity: ${charItem.name} (Canonical Character). ${stateDescription}`);
              }
          });

          // 2. Resolve Props
          presentProps.forEach(name => {
              const propItem = resolveByName(name, propSheet);
              if (propItem) {
                  if (propItem.referenceImage) {
                      sceneRefs.push(propItem.referenceImage);
                  }
                  characterContexts.push(`Prop: ${propItem.name} (Visual Reference Provided).`);
              }
          });

          // 3. Resolve Scenes（第三类资产：场景参考图注入锁跨页一致性，比照 props）
          presentScenes.forEach(name => {
              const sceneItem = resolveByName(name, sceneSheet);
              if (sceneItem) {
                  if (sceneItem.referenceImage) {
                      sceneRefs.push(sceneItem.referenceImage);
                  }
                  characterContexts.push(`Scene/Location: ${sceneItem.name} (Visual Reference Provided — backgrounds MUST match it).`);
              }
          });

          const finalPrompt = `
            Art Style: ${style} (Master Style). ${comicScript.global_art_style} (Style Description).
            
            ACTIVE CHARACTERS & PROPS CONTEXT (STRICTLY use Reference Images for visual details/clothing):
            ${characterContexts.length > 0 ? characterContexts.join("\n") : "No specific characters or props."}

            SCENE DESCRIPTION:
            ${s.image_prompt}
          `.trim() + buildDialogueBlock(s.dialogue); // 结构化对白机械注入（结尾段，无 dialogue 不追加）

          return {
              pageData: {
                  ...s,
                  image_prompt: finalPrompt,
                  isGenerating: true
              } as ComicPageData,
              resolvedRefs: sceneRefs
          };
      });
};

// 方案 4.4：从 handleRegeneratePage 抽出的纯解析函数——按名字解析参考图 + 重建 context 块，
// 与原实现逐字一致；handleRegeneratePage 与批量续绘共用，避免双份漂移。
export const resolvePageRefs = (
    prompt: string,
    characterNames: string[],
    propNames: string[],
    characterSheet: CharacterSheetItem[],
    propSheet: PropSheetItem[],
    sceneNames: string[] = [],
    sceneSheet: SceneSheetItem[] = [],
    dialogue?: ComicPageScript['dialogue']
): { refs: string[]; finalPrompt: string } => {
    const sceneRefs: string[] = [];
    const characterContexts: string[] = [];

    // Resolve Characters
    characterNames.forEach(name => {
        const charItem = resolveByName(name, characterSheet);
        if (charItem) {
            if (charItem.referenceImage) {
                sceneRefs.push(charItem.referenceImage);
            }
            characterContexts.push(`Identity: ${charItem.name} (Canonical Character).`);
        }
    });

    // Resolve Props
    propNames.forEach(name => {
        const propItem = resolveByName(name, propSheet);
        if (propItem) {
            if (propItem.referenceImage) {
                sceneRefs.push(propItem.referenceImage);
            }
            characterContexts.push(`Prop: ${propItem.name} (Visual Reference Provided).`);
        }
    });

    // Resolve Scenes（比照 props 注入）
    sceneNames.forEach(name => {
        const sceneItem = resolveByName(name, sceneSheet);
        if (sceneItem) {
            if (sceneItem.referenceImage) {
                sceneRefs.push(sceneItem.referenceImage);
            }
            characterContexts.push(`Scene/Location: ${sceneItem.name} (Visual Reference Provided — backgrounds MUST match it).`);
        }
    });

    let finalPrompt = stripDialogueBlock(prompt); // 先剥离旧注入块，结尾按当前 dialogue 重注
    if (finalPrompt.includes("ACTIVE CHARACTERS & PROPS CONTEXT") || finalPrompt.includes("ACTIVE CHARACTERS CONTEXT")) {
        // Replace legacy context block if present, or new block
        const contextStart = finalPrompt.indexOf("ACTIVE CHARACTERS");
        const contextEnd = finalPrompt.indexOf("SCENE DESCRIPTION");
        if (contextStart > -1 && contextEnd > -1) {
            const newContextBlock = `ACTIVE CHARACTERS & PROPS CONTEXT (STRICTLY use Reference Images for visual details/clothing):\n${characterContexts.length > 0 ? characterContexts.join("\n") : "No specific characters or props."}\n\n`;
            finalPrompt = finalPrompt.substring(0, contextStart) + newContextBlock + finalPrompt.substring(contextEnd);
        }
    } else {
       // Fallback if structure is messed up: append context at top if it doesn't exist?
       // For now, if user edited it heavily, we trust their text, but update Refs.
    }

    return { refs: sceneRefs, finalPrompt: finalPrompt + buildDialogueBlock(dialogue) };
};
