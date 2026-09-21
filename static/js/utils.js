console.log("[DEBUG] Loaded utils.js");
export const Utils = {
    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
        return outputArray;
    },
    formatDate(dateString) { return new Date(dateString).toLocaleDateString('ru-RU'); },
    formatTime(dateString) { return new Date(dateString).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); },
    formatDuration(seconds) {
        const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    },
    calculateRemainingMacros(consumed, targets) {
        return {
            calories: Math.max(0, (targets.target_calories || 0) - (consumed.total_calories || 0)),
        };
    }
};