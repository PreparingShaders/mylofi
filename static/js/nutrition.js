console.log("[DEBUG] Loaded nutrition.js");
import { API } from './api.js';
import { Components } from './components.js';
import { Utils } from './utils.js';

export const Nutrition = {
    app: null,
    async render(container, app) {
        this.app = app;
        container.innerHTML = '<div>Питание</div>';
    }
};