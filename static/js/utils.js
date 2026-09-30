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
    formatDayMonth(date) { return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); },
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
    },

    computeMacroCalories(macros) {
        const protein = macros.protein || 0;
        const fat = macros.fat || 0;
        const carbs = macros.carbs || 0;
        return {
            protein: protein * 4,
            fat: fat * 9,
            carbs: carbs * 4,
        };
    },

    computeQualityScore(macros, targetCalories = 0) {
        const calories = macros.calories || 0;
        const protein = macros.protein || 0;
        const fat = macros.fat || 0;
        const carbs = macros.carbs || 0;

        if (!calories && !(protein + fat + carbs)) return null;

        const mc = Utils.computeMacroCalories({ protein, fat, carbs });
        const totalCals = (calories > 0 ? calories : (mc.protein + mc.fat + mc.carbs)) || 0;
        if (totalCals <= 0) return null;

        const pPct = (mc.protein / totalCals) * 100;
        const fPct = (mc.fat / totalCals) * 100;
        const cPct = (mc.carbs / totalCals) * 100;

        const pScore = Math.max(0, 100 - Math.abs(pPct - 20) * 2.5);
        const fScore = Math.max(0, 100 - Math.abs(fPct - 30) * 2.5);
        const cScore = Math.max(0, 100 - Math.abs(cPct - 50) * 2.5);

        return Math.round((pScore + fScore + cScore) / 3);
    },

    qualityGrade(score) {
        if (score === null || score < 0) return { label: '—', color: 'text-surface-400' };
        if (score >= 85) return { label: 'Отлично', color: 'text-lime-400' };
        if (score >= 70) return { label: 'Хорошо', color: 'text-sky-400' };
        if (score >= 55) return { label: 'Средне', color: 'text-amber-400' };
        return { label: 'Нужно поправить', color: 'text-rose-400' };
    },

    // Mifflin-St Jeor. Mirrors app/services/nutrition_targets.py so the live
    // preview in the Profile sheet matches the targets the API persists.
    ACTIVITY_FACTORS: {
        sedentary: 1.2,
        light: 1.375,
        moderate: 1.55,
        active: 1.725,
        athlete: 1.9,
    },
    GOAL_CALORIE_FACTORS: { lose: 0.85, maintain: 1.0, gain: 1.15 },
    GENDER_BMR_OFFSETS: { male: 5, female: -161 },
    PROTEIN_GRAMS_PER_KG: { lose: 2.0, maintain: 1.8, gain: 1.8 },
    FAT_CALORIE_RATIO: 0.25,
    LIMITS: {
        age: [10, 100],
        height_cm: [100, 250],
        weight_kg: [30, 300],
    },

    normalizeActivityLevel(value) {
        return this.ACTIVITY_FACTORS[value] ? value : 'moderate';
    },

    normalizeGoal(value) {
        return this.GOAL_CALORIE_FACTORS[value] ? value : 'maintain';
    },

    /**
     * Daily energy and macro targets from the anthropometrics.
     * Returns null when weight, height, age, or gender is missing/invalid.
     */
    calculateKBZhU({ weight, height, age, gender, activity, goal } = {}) {
        const w = parseFloat(weight);
        const h = parseFloat(height);
        const y = parseInt(age, 10);

        if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(y)) return null;
        if (gender !== 'male' && gender !== 'female') return null;
        if (w < this.LIMITS.weight_kg[0] || w > this.LIMITS.weight_kg[1]) return null;
        if (h < this.LIMITS.height_cm[0] || h > this.LIMITS.height_cm[1]) return null;
        if (y < this.LIMITS.age[0] || y > this.LIMITS.age[1]) return null;

        const activityLevel = this.normalizeActivityLevel(activity);
        const target = this.normalizeGoal(goal);

        const bmr = Math.max(10 * w + 6.25 * h - 5 * y + this.GENDER_BMR_OFFSETS[gender], 0);
        const tdee = bmr * this.ACTIVITY_FACTORS[activityLevel];
        const calories = Math.round(tdee * this.GOAL_CALORIE_FACTORS[target]);

        const protein = Math.round(w * this.PROTEIN_GRAMS_PER_KG[target]);
        const fat = Math.round(calories * this.FAT_CALORIE_RATIO / 9);
        // Carbs absorb the remainder, floored at 10% of the energy budget so
        // rounding can never produce an incoherent split.
        const carbs = Math.max(
            Math.round((calories - protein * 4 - fat * 9) / 4),
            Math.round(calories * 0.1 / 4)
        );

        return {
            bmr: Math.round(bmr),
            tdee: Math.round(tdee),
            calories,
            protein_g: protein,
            fat_g: fat,
            carbs_g: carbs,
            activity_level: activityLevel,
            goal: target,
        };
    },
};