export const MUSCLE_GROUP_MAP = {
  грудь: ['chest', 'upper_chest', 'lower_chest'],
  спина: ['upper_back', 'lower_back', 'trapezius', 'rhomboids', 'rotator_cuff', 'serratus', 'latissimus_dorsi', 'erector_spinae'],
  ноги: ['quadriceps', 'hamstrings', 'glutes', 'calves', 'inner_quad', 'outer_quad', 'hip_flexors', 'adductors', 'gluteus_medius', 'gluteus_minimus', 'tensor_fasciae_latae'],
  плечи: ['front_deltoid', 'rear_deltoid', 'deltoids'],
  руки: ['biceps', 'triceps', 'forearms', 'brachialis', 'brachioradialis'],
  пресс: ['abs', 'obliques', 'upper_abs', 'lower_abs', 'rectus_abdominis', 'external_oblique', 'internal_oblique', 'transversus_abdominis'],
};

export function computeHeatmapData(session, exercisesMeta) {
  if (!session?.exercises?.length) return [];

  const muscleWork = new Map();

  for (const ex of session.exercises) {
    const meta = exercisesMeta?.[ex.exercise_id];
    if (!meta?.muscle_group) continue;

    const muscleGroup = meta.muscle_group.toLowerCase();
    const targetMuscles = MUSCLE_GROUP_MAP[muscleGroup] ?? [];
    if (!targetMuscles.length) continue;

    let totalVolume = 0;
    for (const set of ex.sets ?? []) {
      if (!set.is_completed) continue;
      const weight = set.weight_kg ?? 0;
      const reps = set.reps ?? 0;
      totalVolume += weight * reps;
    }

    if (totalVolume === 0) continue;

    for (const muscle of targetMuscles) {
      muscleWork.set(muscle, (muscleWork.get(muscle) ?? 0) + totalVolume / targetMuscles.length);
    }
  }

  if (muscleWork.size === 0) return [];

  const maxWork = Math.max(...muscleWork.values());
  const result = [];
  for (const [muscle, work] of muscleWork) {
    result.push({ muscle, intensity: work / maxWork });
  }

  return result;
}