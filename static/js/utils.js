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
    },

    compressImage(file, maxWidth = 1024, maxHeight = 1024, quality = 0.78) {
        return new Promise((resolve, reject) => {
            if (!file || !(file instanceof Blob)) {
                reject(new Error('compressImage: expected a Blob/File'));
                return;
            }

            const image = new Image();
            image.onload = () => {
                let { width, height } = image;
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('compressImage: canvas export failed'));
                        return;
                    }
                    resolve(blob);
                }, 'image/webp', quality);
            };
            image.onerror = (error) => reject(error);
            image.src = URL.createObjectURL(file);
        });
    },

    fileSizeLabel(bytes) {
        if (!bytes || bytes <= 0) return '0 КБ';
        const units = ['Б', 'КБ', 'МБ', 'ГБ'];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        const value = parseFloat((bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1));
        return `${value} ${units[i]}`;
    }
};