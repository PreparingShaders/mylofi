console.log("[DEBUG] Loaded camera.js");
import { API } from './api.js';

export const Camera = {
    app: null,
    async render(container, app) {
        this.app = app;
        container.innerHTML = '<div>Камера</div>';
    }
};