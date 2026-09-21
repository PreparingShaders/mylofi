console.log("[DEBUG] Loaded workouts.js");
import { API } from './api.js';
import { Components } from './components.js';
import { Utils } from './utils.js';

export const Workouts = {
    app: null,
    async render(container, app) {
        this.app = app;
        container.innerHTML = '<div>Тренировки</div>';
    }
};