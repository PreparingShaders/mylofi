console.log("[DEBUG] Loaded profile.js");
import { API } from './api.js';
import { Components } from './components.js';

export const Profile = {
    app: null,
    async render(container, app) {
        this.app = app;
        container.innerHTML = '<div>Профиль</div>';
    }
};