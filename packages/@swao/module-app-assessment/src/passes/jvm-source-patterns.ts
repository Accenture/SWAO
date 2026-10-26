// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3422: shared helpers for the deterministic Java / Spring patterns of
// Pass 02 (state), Pass 07 (egress) and Pass 08 (crypto). File selection
// works on files listed by the central source scope (listSourceFiles, #3428);
// nothing here walks a directory. The configuration key tracker is shared
// with Pass 06 (config-keys.ts, #3485).

/** JVM source extensions the Java patterns read. */
export const JVM_CODE_EXTENSIONS: ReadonlySet<string> = new Set(['.java', '.kt', '.kts', '.groovy', '.scala']);

/** `application.yml`, `application-prod.properties`, `bootstrap.yaml`, ... */
const SPRING_CONFIG_NAME_RE = /^(?:application|bootstrap)(?:[-.][A-Za-z0-9_.-]{1,60})?\.(?:ya?ml|properties)$/i;

interface NamedFile { name: string; ext: string }

/** True for a JVM source file (`.java`, `.kt`, `.kts`, `.groovy`, `.scala`). */
export function isJvmCodeFile(f: NamedFile): boolean {
  return JVM_CODE_EXTENSIONS.has(f.ext.toLowerCase());
}

/** True for a Spring Boot configuration file (`application*.yml|yaml|properties`, `bootstrap*`). */
export function isSpringConfigFile(f: NamedFile): boolean {
  return SPRING_CONFIG_NAME_RE.test(f.name);
}

/** True for a Java `.properties` file (any name). */
export function isPropertiesFile(f: NamedFile): boolean {
  return f.ext.toLowerCase() === '.properties';
}

/** True for a YAML file (any name). */
export function isYamlFile(f: NamedFile): boolean {
  const e = f.ext.toLowerCase();
  return e === '.yml' || e === '.yaml';
}

/** JVM build files that identify the stack (Maven, Gradle). */
export function isJvmBuildFile(f: NamedFile): boolean {
  const n = f.name.toLowerCase();
  return n === 'pom.xml' || n === 'build.gradle' || n === 'build.gradle.kts';
}

// #3485: the configuration key tracker lives in config-keys.ts (shared with
// the Pass 06 TF-01 evidence); re-exported here for the JVM pattern callers.
export { configKeysPerLine } from './config-keys.js';
