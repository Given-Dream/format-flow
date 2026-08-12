import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QUICK_DELIVERY_OPTIONS, QuickDeliveryStepper, type QuickDeliveryMode } from './QuickDeliveryStepper'

function render(mode: QuickDeliveryMode, attachmentCount = 2, attachmentCopyIndex = 0): string {
  return renderToStaticMarkup(createElement(QuickDeliveryStepper, {
    mode,
    step: 1,
    fillReady: true,
    attachmentCount,
    attachmentCopyIndex,
    pluginConnected: true,
    onMode: () => undefined,
    onCopyText: () => undefined,
    onCopyAllAttachments: () => undefined,
    onCopyNextAttachment: () => undefined,
    onBrowserPlugin: () => undefined
  }))
}

describe('Prompt and Skill quick delivery stepper', () => {
  it('always presents all three remembered delivery modes', () => {
    const markup = render('copy-all')
    expect(QUICK_DELIVERY_OPTIONS.map((option) => option.value)).toEqual([
      'copy-all',
      'copy-one-by-one',
      'browser-plugin'
    ])
    for (const option of QUICK_DELIVERY_OPTIONS) expect(markup).toContain(option.label)
    expect(markup).toContain('Prompt 与 Skill 均完整支持三种方式')
  })

  it('renders the selected copy and browser-plugin controls', () => {
    expect(render('copy-one-by-one', 3, 1)).toContain('逐个复制附件')
    expect(render('browser-plugin')).toContain('填入文本和全部附件')
    expect(render('browser-plugin')).toContain('浏览器插件填充')
  })

  it('keeps the full selector visible when there are no attachments', () => {
    const markup = render('copy-all', 0)
    expect(markup).toContain('没有附件，复制文本后自动完成')
    expect((markup.match(/type="radio"/g) || [])).toHaveLength(3)
  })
})
