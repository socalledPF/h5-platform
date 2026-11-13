<script setup lang="ts">
import { navMode } from '@h5/core'

const appId = __APP_ID__ ?? ''
const buildTime = __BUILD_TIME__ ?? ''
</script>

<template>
  <div
    class="h5-app"
    data-testid="app-root"
    :data-app-id="appId"
    :data-build-time="buildTime"
    :data-nav-mode="navMode"
  >
    <router-view />
  </div>
</template>

<style scoped>
.h5-app {
  box-sizing: border-box;
  width: 100%;
  max-width: var(--app-max-width, 600px);
  min-height: 100vh;
  margin: 0 auto;
}
</style>
