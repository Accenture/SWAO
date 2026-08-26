<template>
  <span
    class="sw-feature-tip"
    @mouseenter="show"
    @mouseleave="hide"
  >
    <slot />
    <Teleport to="body">
      <span
        v-if="tip && visible"
        class="sw-tip-text"
        :style="{ top: tipTop + 'px', left: tipLeft + 'px' }"
      >{{ tip }}</span>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ tip?: string }>()

const visible = ref(false)
const tipTop = ref(0)
const tipLeft = ref(0)

function show(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  tipTop.value = rect.top + window.scrollY - 8
  tipLeft.value = rect.left + rect.width / 2 + window.scrollX
  visible.value = true
}

function hide() {
  visible.value = false
}
</script>

<style>
.sw-feature-tip {
  cursor: help;
  border-bottom: 1px dotted currentColor;
}
.sw-tip-text {
  position: absolute;
  transform: translateX(-50%) translateY(-100%);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
  padding: 8px 12px;
  border-radius: 8px;
  width: 260px;
  font-size: 0.82em;
  font-weight: normal;
  line-height: 1.45;
  z-index: 9999;
  text-align: left;
  white-space: normal;
  pointer-events: none;
}
</style>
