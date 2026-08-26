import DefaultTheme from 'vitepress/theme'
import FeatureTooltip from './FeatureTooltip.vue'
import type { Theme } from 'vitepress'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('FeatureTooltip', FeatureTooltip)
  },
} satisfies Theme
