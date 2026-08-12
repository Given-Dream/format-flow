import type { JSX } from 'react'

export type QuickDeliveryMode = 'copy-all' | 'copy-one-by-one' | 'browser-plugin'

export const QUICK_DELIVERY_OPTIONS: ReadonlyArray<{
  value: QuickDeliveryMode
  label: string
  detail: string
}> = [
  { value: 'copy-all', label: '复制文本＋全部附件', detail: '先复制文本，再一次复制全部附件' },
  { value: 'copy-one-by-one', label: '复制文本＋逐个附件', detail: '先复制文本，再逐个复制每个附件' },
  { value: 'browser-plugin', label: '浏览器插件填充', detail: '填入文本和全部附件，但不自动发送' }
]

export function QuickDeliveryStepper({
  mode,
  step,
  fillReady,
  attachmentCount,
  attachmentCopyIndex,
  pluginConnected,
  onMode,
  onCopyText,
  onCopyAllAttachments,
  onCopyNextAttachment,
  onBrowserPlugin
}: {
  mode: QuickDeliveryMode
  step: 1 | 2
  fillReady: boolean
  attachmentCount: number
  attachmentCopyIndex: number
  pluginConnected: boolean
  onMode: (mode: QuickDeliveryMode) => void
  onCopyText: () => void
  onCopyAllAttachments: () => void
  onCopyNextAttachment: () => void
  onBrowserPlugin: () => void
}): JSX.Element {
  return (
    <section className="quick-delivery-stepper" aria-label="快捷调用交付方式">
      <header className="quick-delivery-header">
        <div>
          <strong>选择交付方式</strong>
          <span>Prompt 与 Skill 均完整支持三种方式；选择会被记住。</span>
        </div>
        <span className="quick-delivery-memory">已记忆</span>
      </header>
      <div className="quick-delivery-modes" role="radiogroup" aria-label="快捷调用交付方式">
        {QUICK_DELIVERY_OPTIONS.map((option) => (
          <label className={mode === option.value ? 'active' : ''} key={option.value}>
            <input
              type="radio"
              name="quick-delivery-mode"
              checked={mode === option.value}
              onChange={() => onMode(option.value)}
            />
            <span><strong>{option.label}</strong><small>{option.detail}</small></span>
          </label>
        ))}
      </div>
      <div className="quick-delivery-steps">
        {mode !== 'browser-plugin' ? (
          <>
            <div className={step === 1 ? 'quick-delivery-step active' : 'quick-delivery-step complete'}>
              <b>1</b><span>复制填充后内容</span>
              {step === 1
                ? <button className="primary-action" type="button" disabled={!fillReady} onClick={onCopyText}>复制填充后内容</button>
                : <small>已完成</small>}
            </div>
            <div className={step === 2 ? 'quick-delivery-step active' : 'quick-delivery-step'}>
              <b>2</b><span>{mode === 'copy-all' ? '一次复制全部附件' : '逐个复制附件'}</span>
              {attachmentCount > 0 ? (
                mode === 'copy-all'
                  ? <button type="button" disabled={step !== 2} onClick={onCopyAllAttachments}>一次复制全部附件</button>
                  : <button type="button" disabled={step !== 2 || attachmentCopyIndex >= attachmentCount} onClick={onCopyNextAttachment}>{attachmentCopyIndex < attachmentCount ? `复制附件 ${attachmentCopyIndex + 1}/${attachmentCount}` : '附件复制完成'}</button>
              ) : <small>没有附件，复制文本后自动完成</small>}
            </div>
          </>
        ) : (
          <div className="quick-delivery-plugin-step">
            <span>填入文本和全部附件</span>
            <button
              className="primary-action"
              type="button"
              disabled={!fillReady}
              title={pluginConnected ? '不自动发送' : '浏览器插件未连接'}
              onClick={onBrowserPlugin}
            >
              浏览器插件填充
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
