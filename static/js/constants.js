/**
 * Application constants - single source of truth for magic numbers,
 * API endpoints, and configuration values.
 */

// Animation & Timing
export const ANIMATION = {
    SHEET_SLIDE_DURATION_MS: 220,
    TOAST_DISPLAY_MS: 3000,
    DEBOUNCE_RESUME_MS: 1000,
    SESSION_REVALIDATE_INTERVAL_MS: 60000,
};

// Meal Analysis
export const MEAL_ANALYSIS = {
    STUCK_THRESHOLD_MS: 3 * 60 * 1000, // 3 minutes
    POLL_INTERVAL_MS: 800,
    POLL_TIMEOUT_MS: 95000,
    LIVE_PUSH_WAIT_MS: 8000,
    MAX_POLL_INTERVAL_MS: 5000,
};

// API Endpoints
export const API_ENDPOINTS = {
    // Nutrition
    NUTRITION_LOGS: '/nutrition/logs',
    NUTRITION_MEALS: '/nutrition/meals',
    NUTRITION_PHOTOS: '/nutrition/photos',
    NUTRITION_WEEK: '/nutrition/week',
    NUTRITION_MONTH: '/nutrition/month',
    NUTRITION_RANGE: '/nutrition/range',
    NUTRITION_DAILY_SUMMARY: '/nutrition/daily-summary',
    NUTRITION_MEAL_RETRY: (mealId) => `/nutrition/meals/${mealId}/retry-analysis`,
    NUTRITION_MEAL_DELETE: (mealId) => `/nutrition/meals/${mealId}`,
    NUTRITION_MEAL_UPDATE: (mealId) => `/nutrition/meals/${mealId}`,
    
    // Workouts
    WORKOUTS_SESSIONS: '/workouts/sessions',
    WORKOUTS_SETS: '/workouts/sets',
    WORKOUTS_TEMPLATES: '/workouts/templates',
    WORKOUTS_STATISTICS: '/workouts/statistics',
    WORKOUTS_HISTORY: '/workouts/history',
    WORKOUTS_TONNAGE: '/workouts/tonnage',
    WORKOUTS_AI_PLAN: '/workouts/ai-plan',
    WORKOUTS_AI_SUMMARY: '/ai/workout-summary',
    
    // AI Synergy
    AI_SYNERGY: '/ai/synergy',
    
    // Auth
    AUTH_LOGIN: '/auth/login',
    AUTH_REGISTER: '/auth/register',
    AUTH_FORGOT_PASSWORD: '/auth/forgot-password',
    AUTH_VERIFY_CODE: '/auth/verify-code',
    AUTH_NEW_PASSWORD: '/auth/new-password',
    
    // Profile
    USER_ME: '/users/me',
    USER_USAGE: '/users/me/usage',
    ANTHROPOMETRICS: '/users/anthropometrics',
    
    // Sync
    SYNC_QUEUE: '/sync/queue',
};

// Cache Configuration
export const CACHE_CONFIG = {
    READ_CACHE_PREFIX: 'offline_read_cache:',
    READ_CACHE_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
    READ_CACHE_MAX_ENTRY_BYTES: 300 * 1024,
    READ_CACHE_TOTAL_BYTES: 2 * 1024 * 1024,
};

// Sync Configuration
export const SYNC_CONFIG = {
    MAX_RETRIES: 3,
    SYNC_TTL_MS: 6 * 60 * 60 * 1000,
    PERIODIC_CLEANUP_INTERVAL_MS: 30 * 60 * 1000,
    QUEUEABLE_METHODS: new Set(['POST', 'PUT', 'PATCH', 'DELETE']),
};

// Realtime Configuration
export const REALTIME_CONFIG = {
    WS_PATH: '/api/v1/ws',
    PING_INTERVAL_MS: 25000,
    PONG_TIMEOUT_MS: 10000,
    RECONNECT_BASE_MS: 1000,
    RECONNECT_MAX_MS: 30000,
    CLOSE_UNAUTHORIZED: 4001,
    TOKEN_EXPIRY_SKEW_MS: 30000,
};

// Request Timeouts
export const REQUEST_TIMEOUTS = {
    DEFAULT_MS: 10000,
    UPLOAD_MS: 30000,
    AI_PREVIEW_MS: 60000,
    HOST_CHECK_MS: 3000,
};

// AI Synergy
export const AI_SYNERGY_CONFIG = {
    COOLDOWN_DAYS: 7,
    MAX_CUSTOM_RANGE_DAYS: 90,
};

// Default Targets
export const DEFAULT_TARGETS = {
    CALORIES: 2000,
    PROTEIN: 150,
    FAT: 65,
    CARBS: 250,
};

// Periods
export const PERIODS = ['day', 'week', 'month', 'custom'];

export const PERIOD_TABS = [
    { value: 'day', label: 'День' },
    { value: 'week', label: '7 дней' },
    { value: 'month', label: 'Месяц' },
    { value: 'custom', label: null, icon: true, ariaLabel: 'Свой диапазон' },
];

// Debounce delays for realtime status
export const DEBOUNCE_DELAYS = {
    OPEN: 1500,
    CLOSED: 3000,
    CONNECTING: 0,
};

// Nutrition read endpoints that get invalidated together
export const NUTRITION_READS = [
    'nutrition/logs',
    'nutrition/summary',
    'nutrition/week',
    'nutrition/month',
    'nutrition/range',
    'nutrition/daily-summary',
];

// Cache relationships for invalidation
export const READ_CACHE_RELATIONSHIPS = {
    'workouts/sets': ['workouts/sessions', 'workouts/statistics', 'workouts/history', 'ai/workout-summary'],
    'workouts/sessions': ['workouts/sessions', 'workouts/statistics', 'workouts/history', 'ai/workout-summary'],
    'workouts/templates': ['workouts/templates'],
    'ai/workout-summary': ['ai/workout-summary'],
    'nutrition/meals': NUTRITION_READS,
    'nutrition/photos': NUTRITION_READS,
    'users/me': ['users/me', 'users/me/usage', ...NUTRITION_READS],
};