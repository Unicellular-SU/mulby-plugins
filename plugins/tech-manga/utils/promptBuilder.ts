// ================= 场景引用解析与页 prompt 拼装（方案 7.4 步骤 3，纯函数） =================
// 从 App.tsx 机械搬移，prompt 字符串逐字节保持（模板字面量内部缩进不得改动）：
// - buildCoverPage / prepareScenePages：首轮批量绘制（prepareScenePages 含
//   persistent_states 的 [ACTION STATE OVERRIDE] 拼装）；
// - resolvePageRefs：单页重绘 / 续绘共用（无状态覆写——与 prepareScenePages 的差异
//   为既有行为，重构不偷改，方案 7.4 步骤 3 注记）。

import { resolveByName } from '@mulby-plugins/manga-kit';
import { CharacterSheetItem, PropSheetItem, ComicPageData, ComicResponse } from '../types';

/** Helper to find character reference image（统一名字解析口径，方案 2.4） */
export const getCharacterReference = (name: string, sheet: CharacterSheetItem[]): string | undefined => {
   return resolveByName(name, sheet)?.referenceImage;
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
    propSheet: PropSheetItem[]
): Array<{ pageData: ComicPageData; resolvedRefs: string[] }> => {
    return comicScript.pages.map(s => {
          const presentCharacters = s.characters_in_scene || [];
          const presentProps = s.props_in_scene || [];

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

          const finalPrompt = `
            Art Style: ${style} (Master Style). ${comicScript.global_art_style} (Style Description).
            
            ACTIVE CHARACTERS & PROPS CONTEXT (STRICTLY use Reference Images for visual details/clothing):
            ${characterContexts.length > 0 ? characterContexts.join("\n") : "No specific characters or props."}

            SCENE DESCRIPTION:
            ${s.image_prompt}
          `.trim();

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
    propSheet: PropSheetItem[]
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

    let finalPrompt = prompt;
    if (prompt.includes("ACTIVE CHARACTERS & PROPS CONTEXT") || prompt.includes("ACTIVE CHARACTERS CONTEXT")) {
        // Replace legacy context block if present, or new block
        const contextStart = prompt.indexOf("ACTIVE CHARACTERS");
        const contextEnd = prompt.indexOf("SCENE DESCRIPTION");
        if (contextStart > -1 && contextEnd > -1) {
            const newContextBlock = `ACTIVE CHARACTERS & PROPS CONTEXT (STRICTLY use Reference Images for visual details/clothing):\n${characterContexts.length > 0 ? characterContexts.join("\n") : "No specific characters or props."}\n\n`;
            finalPrompt = prompt.substring(0, contextStart) + newContextBlock + prompt.substring(contextEnd);
        }
    } else {
       // Fallback if structure is messed up: append context at top if it doesn't exist?
       // For now, if user edited it heavily, we trust their text, but update Refs.
    }

    return { refs: sceneRefs, finalPrompt };
};
