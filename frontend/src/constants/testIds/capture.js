// Test IDs for the wizard / capture feature. Naming follows the directive
// in ./auth.js (keys camelCase, values kebab-case `<feature>-<element>`).

export const CAPTURE = {
	slot: (section) => `capture-slot-${section}`,
	input: (section) => `capture-input-${section}`,
	file: (section, index) => `capture-file-${section}-${index}`,
	expand: (section, index) => `capture-expand-${section}-${index}`,
	edit: (section, index) => `capture-edit-${section}-${index}`,
	remove: (section, index) => `capture-remove-${section}-${index}`,
	previewDialog: 'capture-preview-dialog',
	analyzeBtn: 'capture-analyze-btn',
	reextractBtn: 'capture-reextract-btn',
	nextBtn: 'capture-next-btn',
};

export const SUGGESTIONS = {
	card: (index) => `suggestion-${index}`,
	fixBtn: (index) => `suggestion-${index}-fix-btn`,
};
