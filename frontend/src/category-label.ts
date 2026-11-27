// korean-ok-file: the default categories are stored with Korean names (migration 002); the name is the key and the screen shows the English label

/**
 * The default categories are seeded with Korean names. The stored name stays the key (no data is migrated); this maps it to
 * the English label every screen shows. A category the user renamed or added has no entry here and is shown as typed.
 */
const defaultLabels: Record<string, string> = {
  식비: 'Food',
  교통: 'Transport',
  주거: 'Housing',
  통신: 'Telecom',
  생활: 'Living',
  의료: 'Medical',
  여가: 'Leisure',
  기타: 'Other',
  급여: 'Salary',
  부수입: 'Side income',
};

/** The label to show for a category's stored name. */
export function categoryLabel(name: string) {
  return Object.hasOwn(defaultLabels, name) ? defaultLabels[name] : name;
}
