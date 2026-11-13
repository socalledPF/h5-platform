<script setup lang="ts">
import { PACKAGE_NAME as CORE_PACKAGE_NAME } from '@h5/core'

const corePackage = CORE_PACKAGE_NAME
const appVersion = __APP_VERSION__
const buildTime = __BUILD_TIME__
</script>

<template>
  <main class="home">
    <h1>会员中心</h1>
    <p>app: @h5/app-member · v{{ appVersion }}</p>
    <p>core: {{ corePackage }}</p>
    <p>build: {{ buildTime }}</p>
  </main>
</template>

<style scoped>
.home {
  padding: 16px;
}
</style>
