export const FRONT_MUSCLES = [
  "abs",
  "adductors",
  "biceps",
  "calves",
  "chest",
  "deltoids",
  "feet",
  "forearm",
  "hands",
  "head",
  "hip-flexors",
  "inner-quad",
  "knees",
  "lower-abs",
  "lower-chest",
  "neck",
  "obliques",
  "outer-quad",
  "quadriceps",
  "serratus",
  "tibialis",
  "triceps",
  "upper-abs",
  "upper-chest",
  "front-deltoid"
];

export const BACK_MUSCLES = [
  "adductors",
  "ankles",
  "calves",
  "deltoids",
  "feet",
  "forearm",
  "gluteal",
  "hamstring",
  "hands",
  "head",
  "hip-flexors",
  "knees",
  "lower-back",
  "neck",
  "obliques",
  "quadriceps",
  "rhomboids",
  "rotator-cuff",
  "serratus",
  "tibialis",
  "trapezius",
  "triceps",
  "upper-back",
  "upper-trapezius",
  "lower-trapezius",
  "rear-deltoid"
];

export const ALL_MUSCLES = Array.from(new Set([...FRONT_MUSCLES, ...BACK_MUSCLES])).sort();

export const MUSCLE_GROUPS = {
  chest: ["chest", "upper-chest", "lower-chest"],
  back: ["upper-back", "lower-back", "trapezius", "upper-trapezius", "lower-trapezius", "rhomboids", "rotator-cuff"],
  legs: ["quadriceps", "inner-quad", "outer-quad", "hamstring", "gluteal", "calves", "adductors", "hip-flexors", "knees", "tibialis", "ankles", "feet"],
  arms: ["biceps", "triceps", "deltoids", "front-deltoid", "rear-deltoid", "forearm", "hands"],
  core: ["abs", "upper-abs", "lower-abs", "obliques", "serratus"],
  neck: ["neck", "head"]
};

export const RUS_NAMES = {
  abs: "Пресс",
  adductors: "Приводящие мышцы",
  ankles: "Лодыжки",
  biceps: "Бицепс",
  calves: "Икры",
  chest: "Грудь",
  deltoids: "Дельтовидные",
  feet: "Ступни",
  forearm: "Предплечья",
  gluteal: "Ягодицы",
  hamstring: "Задняя поверхность бедра",
  hands: "Кисти рук",
  head: "Голова",
  "hip-flexors": "Сгибатели бедра",
  "inner-quad": "Внутренняя часть квадрицепса",
  knees: "Колени",
  "lower-abs": "Нижний пресс",
  "lower-back": "Нижняя спина",
  "lower-chest": "Нижняя грудь",
  neck: "Шея",
  obliques: "Косые мышцы",
  "outer-quad": "Внешняя часть квадрицепса",
  quadriceps: "Квадрицепс",
  "rear-deltoid": "Задняя дельта",
  rhomboids: "Ромбовидные",
  "rotator-cuff": "Вращательная манжета",
  serratus: "Зубатые мышцы",
  tibialis: "Передняя большеберцовая",
  trapezius: "Трапеция",
  triceps: "Трицепс",
  "upper-abs": "Верхний пресс",
  "upper-back": "Верхняя спина",
  "upper-chest": "Верхняя грудь",
  "upper-trapezius": "Верх трапеции",
  "lower-trapezius": "Низ трапеции",
  "front-deltoid": "Передняя дельта"
};

export function getMusclesForSide(side) {
  return side === "front" ? FRONT_MUSCLES : BACK_MUSCLES;
}

export function getMuscleGroup(muscle) {
  for (const [group, muscles] of Object.entries(MUSCLE_GROUPS)) {
    if (muscles.includes(muscle)) return group;
  }
  return "other";
}

export function getRussianName(muscle) {
  return RUS_NAMES[muscle] ?? muscle;
}

export function isFrontMuscle(muscle) {
  return FRONT_MUSCLES.includes(muscle);
}

export function isBackMuscle(muscle) {
  return BACK_MUSCLES.includes(muscle);
}