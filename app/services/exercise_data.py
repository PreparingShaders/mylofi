from typing import Dict, List

MUSCLE_GROUPS: Dict[str, str] = {
    "quadriceps": "Квадрицепсы",
    "hamstrings": "Бицепсы бедра",
    "glutes": "Ягодицы",
    "calves": "Икры",
    "chest": "Грудь",
    "back": "Спина",
    "shoulders": "Плечи",
    "biceps": "Бицепсы",
    "triceps": "Трицепсы",
    "abs": "Пресс",
    "forearms": "Предплечья",
    "full_body": "Полное тело",
}

EQUIPMENT: Dict[str, str] = {
    "barbell": "Штанга",
    "dumbbell": "Гантели",
    "machine": "Тренажёр",
    "cable": "Кабель",
    "bodyweight": "Собственный вес",
    "kettlebell": "Гиря",
    "resistance_band": "Резинка",
    "smith_machine": "Смит",
    "ez_bar": "EZ-штанга",
    "hammer": "Хаммер",
}

EXERCISE_SEED: List[dict] = [
    # Грудь
    {"name": "Жим штанги лежа", "muscle_group": "chest", "equipment": "barbell", "is_compound": True},
    {"name": "Жим гантелей лежа", "muscle_group": "chest", "equipment": "dumbbell", "is_compound": True},
    {"name": "Жим гантелей на наклонной скамье", "muscle_group": "chest", "equipment": "dumbbell", "is_compound": True},
    {"name": "Жим в тренажере на грудь", "muscle_group": "chest", "equipment": "machine", "is_compound": True},
    {"name": "Жим в Хаммере на грудь", "muscle_group": "chest", "equipment": "hammer", "is_compound": True},
    {"name": "Жим в Хаммере наклонный (вверх)", "muscle_group": "chest", "equipment": "hammer", "is_compound": True},
    {"name": "Жим лежа в Смите", "muscle_group": "chest", "equipment": "smith_machine", "is_compound": True},
    {"name": "Жим на наклонной скамье в Смите", "muscle_group": "chest", "equipment": "smith_machine", "is_compound": True},
    {"name": "Сведение рук в тренажере (Пек-дек)", "muscle_group": "chest", "equipment": "machine", "is_compound": False},
    {"name": "Кроссовер (сведение рук на блоке)", "muscle_group": "chest", "equipment": "cable", "is_compound": False},
    {"name": "Отжимания на брусьях", "muscle_group": "chest", "equipment": "bodyweight", "is_compound": True},
    {"name": "Отжимания от пола", "muscle_group": "chest", "equipment": "bodyweight", "is_compound": True},

    # Спина
    {"name": "Подтягивания", "muscle_group": "back", "equipment": "bodyweight", "is_compound": True},
    {"name": "Тяга верхнего блока к груди", "muscle_group": "back", "equipment": "cable", "is_compound": True},
    {"name": "Тяга горизонтального блока к поясу", "muscle_group": "back", "equipment": "cable", "is_compound": True},
    {"name": "Тяга штанги в наклоне", "muscle_group": "back", "equipment": "barbell", "is_compound": True},
    {"name": "Тяга гантели одной рукой", "muscle_group": "back", "equipment": "dumbbell", "is_compound": True},
    {"name": "Тяга в тренажере с упором грудью", "muscle_group": "back", "equipment": "machine", "is_compound": True},
    {"name": "Тяга в Хаммере (горизонтальная)", "muscle_group": "back", "equipment": "hammer", "is_compound": True},
    {"name": "Тяга в Хаммере вертикальная", "muscle_group": "back", "equipment": "hammer", "is_compound": True},
    {"name": "Пуловер на верхнем блоке", "muscle_group": "back", "equipment": "cable", "is_compound": False},
    {"name": "Гиперэкстензия", "muscle_group": "back", "equipment": "machine", "is_compound": False},
    {"name": "Становая тяга со штангой", "muscle_group": "back", "equipment": "barbell", "is_compound": True},

    # Ноги (Квадрицепсы, Бицепс бедра, Ягодицы, Икры)
    {"name": "Приседания со штангой", "muscle_group": "quadriceps", "equipment": "barbell", "is_compound": True},
    {"name": "Приседания в Смите", "muscle_group": "quadriceps", "equipment": "smith_machine", "is_compound": True},
    {"name": "Жим ногами в тренажере", "muscle_group": "quadriceps", "equipment": "machine", "is_compound": True},
    {"name": "Гакк-приседания", "muscle_group": "quadriceps", "equipment": "machine", "is_compound": True},
    {"name": "Разгибание ног сидя (в тренажере)", "muscle_group": "quadriceps", "equipment": "machine", "is_compound": False},
    {"name": "Сгибание ног лежа (в тренажере)", "muscle_group": "hamstrings", "equipment": "machine", "is_compound": False},
    {"name": "Румынская тяга со штангой", "muscle_group": "hamstrings", "equipment": "barbell", "is_compound": True},
    {"name": "Румынская тяга с гантелями", "muscle_group": "hamstrings", "equipment": "dumbbell", "is_compound": True},
    {"name": "Ягодичный мостик со штангой (Hip Thrust)", "muscle_group": "glutes", "equipment": "barbell", "is_compound": True},
    {"name": "Ягодичный мостик в Смите", "muscle_group": "glutes", "equipment": "smith_machine", "is_compound": True},
    {"name": "Сведение ног в тренажере", "muscle_group": "glutes", "equipment": "machine", "is_compound": False},
    {"name": "Разведение ног в тренажере", "muscle_group": "glutes", "equipment": "machine", "is_compound": False},
    {"name": "Выпады с гантелями", "muscle_group": "quadriceps", "equipment": "dumbbell", "is_compound": True},
    {"name": "Выпады в Смите", "muscle_group": "quadriceps", "equipment": "smith_machine", "is_compound": True},
    {"name": "Болгарские сплит-приседания", "muscle_group": "quadriceps", "equipment": "dumbbell", "is_compound": True},
    {"name": "Подъемы на носки стоя (в тренажере)", "muscle_group": "calves", "equipment": "machine", "is_compound": False},
    {"name": "Подъемы на носки в Смите", "muscle_group": "calves", "equipment": "smith_machine", "is_compound": False},

    # Плечи
    {"name": "Армейский жим стоя", "muscle_group": "shoulders", "equipment": "barbell", "is_compound": True},
    {"name": "Жим гантелей сидя", "muscle_group": "shoulders", "equipment": "dumbbell", "is_compound": True},
    {"name": "Жим в Смите сидя (на плечи)", "muscle_group": "shoulders", "equipment": "smith_machine", "is_compound": True},
    {"name": "Жим в Хаммере на плечи", "muscle_group": "shoulders", "equipment": "hammer", "is_compound": True},
    {"name": "Махи гантелями в стороны", "muscle_group": "shoulders", "equipment": "dumbbell", "is_compound": False},
    {"name": "Махи гантелями в наклоне (задняя дельта)", "muscle_group": "shoulders", "equipment": "dumbbell", "is_compound": False},
    {"name": "Махи в кроссовере в стороны", "muscle_group": "shoulders", "equipment": "cable", "is_compound": False},
    {"name": "Протяжка со штангой к подбородку", "muscle_group": "shoulders", "equipment": "barbell", "is_compound": True},
    {"name": "Шраги в Смите", "muscle_group": "shoulders", "equipment": "smith_machine", "is_compound": False},

    # Руки (Бицепс, Трицепс)
    {"name": "Сгибания рук со штангой на бицепс", "muscle_group": "biceps", "equipment": "barbell", "is_compound": False},
    {"name": "Сгибания рук с гантелями стоя", "muscle_group": "biceps", "equipment": "dumbbell", "is_compound": False},
    {"name": "Сгибания рук «Молот» с гантелями", "muscle_group": "biceps", "equipment": "dumbbell", "is_compound": False},
    {"name": "Сгибания рук на бицепс на нижнем блоке", "muscle_group": "biceps", "equipment": "cable", "is_compound": False},
    {"name": "Разгибания рук с канатом на верхнем блоке (трицепс)", "muscle_group": "triceps", "equipment": "cable", "is_compound": False},
    {"name": "Французский жим со штангой лежа", "muscle_group": "triceps", "equipment": "barbell", "is_compound": False},
    {"name": "Французский жим с EZ-грифом", "muscle_group": "triceps", "equipment": "ez_bar", "is_compound": False},
    {"name": "Разгибания рук из-за головы с гантелью", "muscle_group": "triceps", "equipment": "dumbbell", "is_compound": False},
    {"name": "Жим лежа узким хватом", "muscle_group": "triceps", "equipment": "barbell", "is_compound": True},

    # Пресс и Кор
    {"name": "Скручивания на полу", "muscle_group": "abs", "equipment": "bodyweight", "is_compound": False},
    {"name": "Подъем ног в висе", "muscle_group": "abs", "equipment": "bodyweight", "is_compound": True},
    {"name": "Скручивания на блоке («Молитва»)", "muscle_group": "abs", "equipment": "cable", "is_compound": False},
    {"name": "Планка", "muscle_group": "abs", "equipment": "bodyweight", "is_compound": False},
]
