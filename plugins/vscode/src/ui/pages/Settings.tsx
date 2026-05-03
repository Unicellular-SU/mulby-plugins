import React, { useState, useEffect } from 'react';
import { useMulby } from '../hooks/useMulby';

interface Config {
  code: string;
  icon?: string;
  terminal?: string;
  command?: string;
  database?: string;
  timeout?: string;
}

interface Props {
  code: string;
}

export default function Settings({ code }: Props) {
  const { call, notification } = useMulby();
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await call('getConfig', code);
        if (result) setConfig(result);
      } catch {
        notification.show('加载配置失败', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [code, call, notification]);

  const handleChange = (key: string, value: string) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    if (config.icon && !config.icon.includes('png')) {
      notification.show('图标格式必须是 png', 'error');
      return;
    }
    try {
      await call('saveConfig', config);
      notification.show(`${code} 配置已保存`);
      (window as any).mulby?.plugin?.outPlugin(true);
    } catch {
      notification.show('保存失败', 'error');
    }
  };

  if (loading) return <div className="loading">加载中...</div>;
  if (!config) return <div className="empty-state">未找到配置</div>;

  const fields = [
    { key: 'code', label: 'code', tip: 'IDE 唯一标识，也是插件输入标识，例如 vsc/cursor' },
    { key: 'icon', label: '图标', tip: '请输入图标相对路径，仅支持 png 图片，默认值 icon/icon.png' },
    { key: 'terminal', label: '终端环境', tip: '请输入您要使用的终端环境类型, zsh -l -c 等，Windows 用户请勿输入' },
    { key: 'command', label: '执行命令', tip: 'IDE 的执行命令，例如 code，请先在终端执行 code . 进行测试' },
    { key: 'database', label: '数据库配置', tip: '输入 IDE 数据库文件地址' },
    { key: 'timeout', label: '超时时间(ms)', tip: '设置命令执行的超时时间，单位为 ms' },
  ];

  return (
    <div className="settings-page">
      <h3 className="settings-title">{code} 设置</h3>
      <form onSubmit={handleSubmit}>
        {fields.map(({ key, label, tip }) => (
          <div className="form-group" key={key}>
            <label>{label}</label>
            <div className="input-container">
              <input
                type={key === 'timeout' ? 'number' : 'text'}
                name={key}
                value={config[key] || ''}
                onChange={(e) => handleChange(key, e.target.value)}
              />
              <div className="input-tips">{tip}</div>
            </div>
          </div>
        ))}
        <button type="submit" className="save-btn">保存设置</button>
      </form>
    </div>
  );
}
