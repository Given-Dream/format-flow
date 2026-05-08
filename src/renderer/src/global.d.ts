import type { FormatFlowApi } from '../../../preload'

declare global {
  interface Window {
    formatFlow: FormatFlowApi
  }
}

export {}
