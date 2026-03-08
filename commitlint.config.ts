export default {
	extends: ["@commitlint/config-conventional"],
	rules: {
		"scope-enum": [
			2,
			"always",
			["github", "sync", "ui", "settings", "utils", "types", "deps", "infra"],
		],
	},
};
