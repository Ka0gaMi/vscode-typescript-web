import type {FileSystem, FileType} from 'vscode';
import type {URI} from 'vscode-uri';
import FunctionBroadcastChannel from "./functionBroadcastChannel";

const textCache = new Map<string,  Promise<string | undefined>>();
const jsonCache = new Map<string,  Promise<any>>();

const broadcast = new FunctionBroadcastChannel({
    id: 'Omega365-vscode-wrapper'
});

export function createNpmFileSystem(
    getCdnPath = (uri: URI): string | undefined => {
        if (uri.path === '/node_modules') {
            return '';
        } else if (uri.path.startsWith('/node_modules/')) {
            return uri.path.slice('/node_modules/'.length);
        }
    },
    getPackageVersion?: (packageName: string) => string | undefined
): FileSystem {
    const fetchResults = new Map<string, Promise<string | undefined>>();
    const flatResults = new Map<string,  Promise<{
        name: string; 
        size: number;
        time: string;
        hash: string;
    }[]>>();
    
    return {
        async stat(uri) {
            const path = getCdnPath(uri);
            if (path === undefined) {
                return;
            }
            if (path === '') {
                return {
                    type: 2 satisfies FileType.Directory,
                    size: -1,
                    ctime: -1,
                    mtime: -1,
                };
            }
            return await _stat(path);
        },
        async readFile(uri) {
            const path = getCdnPath(uri);
            if (path === undefined) {
                return;
            }
            return await _readFile(path);
        },
        readDirectory(uri) {
            const path = getCdnPath(uri);
            if (path === undefined) {
                return [];
            }
            return _readDirectory(path);
        }
    }
    
    async function _stat(path: string) {
        const [modName, pkgName, pkgFilePath] = resolvePackageName(path);
        if (!pkgName) {
            if (modName.startsWith('@')) {
                return {
                    type: 2 satisfies FileType.Directory,
                    ctime: -1,
                    mtime: -1,
                    size: -1,
                };
            }
            else {
                return;
            }
        }
        if (!await isValidPackageName(pkgName)) {
            return;
        }

        if (!pkgFilePath) {
            // perf: skip flat request
            return {
                type: 2 satisfies FileType.Directory,
                ctime: -1,
                mtime: -1,
                size: -1,
            };
        }

        if (!flatResults.has(modName)) {
            flatResults.set(modName, flat(pkgName));
        }

        const flatResult = await flatResults.get(modName)!;
        const filePath = path.slice(modName.length);
        const file = flatResult.find(file => file.name === filePath);
        if (file) {
            return {
                type: 1 satisfies FileType.File,
                ctime: new Date(file.time).valueOf(),
                mtime: new Date(file.time).valueOf(),
                size: file.size,
            };
        }
        else if (flatResult.some(file => file.name.startsWith(filePath + '/'))) {
            return {
                type: 2 satisfies FileType.Directory,
                ctime: -1,
                mtime: -1,
                size: -1,
            };
        }
    }
    
    async function _readDirectory(path: string): Promise<[string,  FileType][]> {
        const [modName, pkgName] = resolvePackageName(path);
        if (!pkgName || !await isValidPackageName(pkgName)) {
            return [];
        }
        
        if (!flatResults.has(modName)) {
            flatResults.set(modName, flat(pkgName));
        }
        
        const flatResult = await flatResults.get(modName)!;
        const dirPath = path.slice(modName.length);
        const files = flatResult
            .filter(f => f.name.substring(0, f.name.lastIndexOf('/')) === dirPath)
            .map(f => f.name.slice(dirPath.length + 1));
        const dirs = flatResult
            .filter(f => f.name.startsWith(dirPath + '/') && f.name.substring(dirPath.length + 1).split('/').length >= 2)
            .map(f => f.name.slice(dirPath.length + 1).split('/')[0]);
        
        return [
            ...files.map<[string,  FileType]>(f => [f, 1 satisfies FileType.File]),
            ...[...new Set(dirs)].map<[string,  FileType]>(files => [files,  2 satisfies FileType.Directory])
        ]
    }
    
    async function _readFile(path: string): Promise<string | undefined> {
        const [_modName, pkgName, _version, pkgFilePath] = resolvePackageName(path);
        if (!pkgName || !pkgFilePath || !await isValidPackageName(pkgName)) {
            return;
        }
        
        if (!fetchResults.has(path)) {
           fetchResults.set(path, (async () => {
               if ((await _stat(path))?.type !== 1 satisfies FileType.File) {
                   return;
               }
               return await fetchText(pkgName);
           })()); 
        }
        
        return (await fetchResults.get(path))!;
    }
    
    async function flat(pkgName: string) {
        const flat =  await fetchJson<{
            files: {
                name: string;
                size: number;
                time: string;
                hash: string;
            }[];
        }>(pkgName);
            
        if (!flat) {
            return [];
        }
        
        return flat.files;
    }
    
    async function isValidPackageName(pkgName: string) {
        if (pkgName.endsWith('/node_modules')) {
            return false;
        }

        if (pkgName.endsWith('.d.ts') || pkgName.startsWith('@typescript/') || pkgName.startsWith('@types/typescript__')) {
            return false;
        }

        if (pkgName.startsWith('@types/')) {
            let originalPkgName = pkgName.slice('@types/'.length);
            if (originalPkgName.indexOf('__') >= 0) {
                originalPkgName = '@' + originalPkgName.replace('__', '/');
            }
            const packageJson = await _readFile(`${originalPkgName}/package.json`);
            if (!packageJson) {
                return false;
            }
            const packageJsonObj = JSON.parse(packageJson);
            if (packageJsonObj.types || packageJsonObj.typings) {
                return false;
            }
            const indexDts = await _stat(`${originalPkgName}/index.d.ts`);
            if (indexDts?.type === 1 satisfies FileType.File) {
                return false;
            }
        }
        return true;
    }

    function resolvePackageName(input: string): [
        modName: string,
        pkgName: string | undefined,
        version: string | undefined,
        path: string,
    ] {
        const parts = input.split('/');
        let modName = parts[0];
        let path: string;
        if (modName.startsWith('@')) {
            if (!parts[1]) {
                return [modName, undefined, undefined, ''];
            }
            modName += '/' + parts[1];
            path = parts.slice(2).join('/');
        }
        else {
            path = parts.slice(1).join('/');
        }
        let pkgName = modName;
        let version: string | undefined;
        if (modName.lastIndexOf('@') >= 1) {
            pkgName = modName.substring(0, modName.lastIndexOf('@'));
            version = modName.substring(modName.lastIndexOf('@') + 1);
        }
        if (!version && getPackageVersion) {
            getPackageVersion?.(pkgName);
        }
        return [modName, pkgName, version, path];
    }

    async function fetchText(pkgName: string) {
        if (!textCache.has(pkgName)) {
            textCache.set(pkgName, (async () => {
                return await broadcast.execute('getTypes', pkgName);
            })());
        }
        return await textCache.get(pkgName)!;
    }

    async function fetchJson<T>(pkgName: string) {
        if (!jsonCache.has(pkgName)) {
            jsonCache.set(pkgName, (async () => {
                return await broadcast.execute('getTypesFlat', pkgName);
            })());
        }
        return await jsonCache.get(pkgName)! as T;
    }
}