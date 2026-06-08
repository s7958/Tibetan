/**
 * 从 ryuchan.config.yaml 同步 GitHub 配置到 .env 文件
 * 用法: node scripts/sync-env.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const CONFIG_PATH = path.resolve('ryuchan.config.yaml');
const ENV_PATH = path.resolve('.env');
const ENV_EXAMPLE_PATH = path.resolve('.env.example');

// 占位符值，这些值不会从 YAML 同步
const PLACEHOLDER_VALUES = ['在部署端配置环境变量', '-', ''];

function readYamlConfig() {
	try {
		const content = fs.readFileSync(CONFIG_PATH, 'utf8');
		const config = yaml.load(content);
		return config?.github || {};
	} catch (e) {
		console.error('❌ 读取 ryuchan.config.yaml 失败:', e.message);
		return null;
	}
}

function parseExistingEnv() {
	const envMap = new Map();
	
	if (!fs.existsSync(ENV_PATH)) {
		return envMap;
	}
	
	const content = fs.readFileSync(ENV_PATH, 'utf8');
	const lines = content.split('\n');
	
	for (const line of lines) {
		const trimmed = line.trim();
		// 跳过注释和空行
		if (!trimmed || trimmed.startsWith('#')) continue;
		
		const eqIndex = trimmed.indexOf('=');
		if (eqIndex > 0) {
			const key = trimmed.slice(0, eqIndex).trim();
			const value = trimmed.slice(eqIndex + 1).trim();
			envMap.set(key, value);
		}
	}
	
	return envMap;
}

function syncEnv() {
	console.log('🔄 同步 GitHub 配置到 .env...\n');
	
	const githubConfig = readYamlConfig();
	if (!githubConfig) {
		process.exit(1);
	}
	
	const existingEnv = parseExistingEnv();
	
	// 映射关系: YAML 字段 -> 环境变量名
	const mapping = [
		{ yamlKey: 'owner', envKey: 'PUBLIC_GITHUB_OWNER', default: 'kobaridev' },
		{ yamlKey: 'repo', envKey: 'PUBLIC_GITHUB_REPO', default: 'RyuChan' },
		{ yamlKey: 'branch', envKey: 'PUBLIC_GITHUB_BRANCH', default: 'main' },
		{ yamlKey: 'appId', envKey: 'PUBLIC_GITHUB_APP_ID', default: '' },
		{ yamlKey: 'encryptKey', envKey: 'PUBLIC_GITHUB_ENCRYPT_KEY', default: 'wudishiduomejimo' },
	];
	
	const newEnv = new Map(existingEnv);
	let changed = false;
	
	for (const { yamlKey, envKey, default: defaultValue } of mapping) {
		const yamlValue = githubConfig[yamlKey];
		const existingValue = existingEnv.get(envKey);
		
		// 如果 YAML 值是占位符，保留现有值
		if (PLACEHOLDER_VALUES.includes(yamlValue)) {
			if (!existingValue) {
				console.log(`⚠️  ${envKey}: YAML 中为占位符，且 .env 中未设置`);
				newEnv.set(envKey, defaultValue || '');
			} else {
				console.log(`📌 ${envKey}: 保留现有值 "${existingValue}" (YAML 为占位符)`);
			}
			continue;
		}
		
		// 使用 YAML 值或默认值
		const finalValue = yamlValue || defaultValue;
		
		if (existingValue !== finalValue) {
			console.log(`✏️  ${envKey}: "${existingValue || '(未设置)'}" → "${finalValue}"`);
			newEnv.set(envKey, finalValue);
			changed = true;
		} else {
			console.log(`✅ ${envKey}: "${finalValue}" (无变化)`);
		}
	}
	
	if (!changed && fs.existsSync(ENV_PATH)) {
		console.log('\n✨ 配置已是最新，无需更新');
		return;
	}
	
	// 生成 .env 内容
	const envContent = generateEnvContent(newEnv);
	fs.writeFileSync(ENV_PATH, envContent, 'utf8');
	console.log('\n✅ .env 文件已更新');
}

function generateEnvContent(envMap) {
	const lines = [
		'# GitHub App Configuration',
		'# 此文件由 scripts/sync-env.mjs 从 ryuchan.config.yaml 同步生成',
		'',
		'# 你的 GitHub 用户名',
		`PUBLIC_GITHUB_OWNER=${envMap.get('PUBLIC_GITHUB_OWNER') || 'kobaridev'}`,
		'',
		'# 你的仓库名称',
		`PUBLIC_GITHUB_REPO=${envMap.get('PUBLIC_GITHUB_REPO') || 'RyuChan'}`,
		'',
		'# 你的仓库分支',
		`PUBLIC_GITHUB_BRANCH=${envMap.get('PUBLIC_GITHUB_BRANCH') || 'main'}`,
		'',
		'# 你的 GitHub App ID（在 GitHub App -> General -> App ID 中查找）',
		'# 此值需要在 .env 中手动设置，或通过 Cloudflare 环境变量配置',
		`PUBLIC_GITHUB_APP_ID=${envMap.get('PUBLIC_GITHUB_APP_ID') || ''}`,
		'',
		'# 用于加密存储私钥的密钥',
		`PUBLIC_GITHUB_ENCRYPT_KEY=${envMap.get('PUBLIC_GITHUB_ENCRYPT_KEY') || 'wudishiduomejimo'}`,
	];
	
	return lines.join('\n') + '\n';
}

syncEnv();
