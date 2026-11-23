import { MuscleMap as BaseMuscleMap, getMuscle, MUSCLE_GROUPS, DEFAULT_THEME, DEFAULT_GENDER, DEFAULT_VIEW } from '/static/js/vendor/muscle-map/muscle-map.js';

const STYLE_NEON = 'neon';

function setLocale(_locale) {
}

function getMuscleName(muscleId) {
  const muscle = getMuscle(muscleId);
  return muscle?.name ?? muscleId;
}

const RU_MUSCLE_NAMES = {
  'chest': 'Грудь',
  'upper_chest': 'Верхняя грудь',
  'lower_chest': 'Нижняя грудь',
  'abs': 'Пресс',
  'upper_abs': 'Верхний пресс',
  'lower_abs': 'Нижний пресс',
  'obliques': 'Косые мышцы',
  'biceps': 'Бицепс',
  'triceps': 'Трицепс',
  'forearms': 'Предплечья',
  'front_deltoid': 'Передняя дельта',
  'rear_deltoid': 'Задняя дельта',
  'lats': 'Крылья',
  'upper_back': 'Верх спины',
  'lower_back': 'Нижняя спина',
  'glutes': 'Ягодицы',
  'quads': 'Квадрицепс',
  'hamstrings': 'Бицепс бедра',
  'calves': 'Икроножные',
  'trapezius': 'Трапеция',
  'rhomboids': 'Ромбовидные',
  'rotator_cuff': 'Вращательная манжета',
  'serratus': 'Зубаточные мышцы',
  'inner_quad': 'Внутренний квадрицепс',
  'outer_quad': 'Наружный квадрицепс',
  'hip_flexors': 'Сгибатели бедра',
  'adductors': 'Приводящие мышцы',
  'gluteal': 'Ягодичные мышцы',
  'hip_flexors': 'Сгибатели бедра',
  'quadriceps': 'Квадрицепс',
  'hamstring': 'Бицепс бедра',
  'calves': 'Икроножные',
  'deltoids': 'Дельтовидные мышцы',
  'erector_spinae': 'Выпрямители позвоночника',
  'sternocleidomastoid': 'Сternoключично-сосцевидная',
  'scalenes': 'Лесенчатые мышцы',
  'pectoralis_major': 'Большая грудная мышца',
  'pectoralis_minor': 'Малая грудная мышца',
  'latissimus_dorsi': 'Широчайшая мышца спины',
  'trapezius': 'Трапеция',
  'rhomboids': 'Ромбовидные мышцы',
  'infraspinatus': 'Подостная мышца',
  'teres_major': 'Большая круглая мышца',
  'teres_minor': 'Малая круглая мышца',
  'subscapularis': 'Подлопаточная мышца',
  'supraspinatus': 'Надкостная мышца',
  'biceps_brachii': 'Двуглавая мышца плеча',
  'triceps_brachii': 'Триглавная мышца плеча',
  'brachialis': 'Локтевая мышца',
  'brachioradialis': 'Лучезапястная мышца',
  'forearm_flexors': 'Сгибатели предплечья',
  'forearm_extensors': 'Разгибатели предплечья',
  'rectus_abdominis': 'Прямая мышца живота',
  'external_oblique': 'Наружная косая мышца живота',
  'internal_oblique': 'Внутренняя косая мышца живота',
  'transversus_abdominis': 'Поперечная мышца живота',
  'gluteus_maximus': 'Большая ягодичная мышца',
  'gluteus_medius': 'Средняя ягодичная мышца',
  'gluteus_minimus': 'Малая ягодичная мышца',
  'tensor_fasciae_latae': 'Натягатель широкой фасции',
  'rectus_femoris': 'Прямая мышца бедра',
  'vastus_lateralis': 'Наружная широкая мышца бедра',
  'vastus_medialis': 'Внутренняя широкая мышца бедра',
  'vastus_intermedius': 'Промежуточная широкая мышца бедра',
  'biceps_femoris': 'Двуглавая мышца бедра',
  'semitendinosus': 'Полусухожильная мышца',
  'semimembranosus': 'Полуперепончатая мышца',
  'gastrocnemius': 'Двуглавная мышца голени',
  'soleus': 'Подколенная мышца',
  'tibialis_anterior': 'Передняя голенная мышца',
  'peroneus_longus': 'Длинная пероневая мышца',
  'peroneus_brevis': 'Короткая пероневая мышца',
};

function getRuMuscleName(muscleId) {
  return RU_MUSCLE_NAMES[muscleId] ?? getMuscleName(muscleId);
}

class HeatmapLegend {
  constructor(container, options = {}) {
    this.container = container;
    this.options = { colorScale: options.colorScale ?? 'workout', orientation: options.orientation ?? 'horizontal' };
    this.render();
  }

  render() {
    const colors = ['#001f3f', '#003d7a', '#0074d9', '#00aaff', '#39cccc', '#7fdbff', '#b8e8ff', '#d0f4ff', '#e8faff', '#ffffff'];
    const gradient = `linear-gradient(90deg, ${colors.join(', ')})`;
    const labels = this.options.orientation === 'horizontal' ? ['Низкая', 'Высокая'] : ['Высокая', 'Низкая'];
    
    this.container.innerHTML = `
      <div class="muscle-map-legend" style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary, #888);">
        <span>${labels[0]}</span>
        <div style="flex: 1; height: 8px; border-radius: 4px; background: ${gradient};"></div>
        <span>${labels[1]}</span>
      </div>
    `;
  }

  destroy() {
    this.container.innerHTML = '';
  }
}

export class MuscleMap {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.widget = new BaseMuscleMap(container, {
      gender: options.gender ?? DEFAULT_GENDER,
      view: options.side ?? DEFAULT_VIEW,
      theme: options.theme ?? DEFAULT_THEME,
      color: options.color ?? '#00e5ff',
      blendMode: 'multiply',
      hoverHighlight: true,
      highlights: options.highlights ?? [],
      onMuscleClick: (target) => this.emit('select', { muscle: target.id, side: this.options.side ?? DEFAULT_VIEW, name: getRuMuscleName(target.id) }),
      onMuscleEnter: (target) => this.emit('hover', { muscle: target.id, name: getRuMuscleName(target.id) }),
      onMuscleLeave: (target) => this.emit('leave', { muscle: target.id, name: getRuMuscleName(target.id) }),
    });
    this.legend = null;
    this.listeners = new Map();
  }

  setView(side) {
    this.options.side = side;
    this.widget.update({ view: side });
  }

  setGender(gender) {
    this.options.gender = gender;
    this.widget.update({ gender });
  }

  highlightMuscle(muscleId, color = '#00e5ff') {
    this.widget.update({
      highlights: [{ id: muscleId, intensity: 100, color }]
    });
  }

  setHeatmap(data) {
    const highlights = data.map(d => ({
      id: d.muscle,
      intensity: Math.round(d.intensity * 100),
      color: d.color ?? '#00e5ff'
    }));
    this.widget.update({ highlights });
  }

  clear() {
    this.widget.update({ highlights: [] });
  }

  getSelection() {
    return [];
  }

  mountLegend(container) {
    this.legend = new HeatmapLegend(container, { colorScale: 'workout', orientation: 'horizontal' });
  }

  destroy() {
    this.widget.destroy();
    this.legend?.destroy?.();
    this.listeners.clear();
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
  }

  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event, data) {
    this.listeners.get(event)?.forEach(h => h(data));
    window.dispatchEvent(new CustomEvent(`muscle-map:${event}`, { detail: data }));
  }
}

export { setLocale, getMuscleName as getRuMuscleName, STYLE_NEON, HeatmapLegend };