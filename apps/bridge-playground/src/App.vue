<script setup lang="ts">
const appId = __APP_ID__
const appVersion = __APP_VERSION__
</script>

<template>
  <div class="h5-app" :data-app-id="appId" :data-app-version="appVersion">
    <router-view />
  </div>
</template>

<style scoped>
.h5-app {
  box-sizing: border-box;
  width: 100%;
  max-width: 600px;
  min-height: 100vh;
  margin: 0 auto;
}
</style>
