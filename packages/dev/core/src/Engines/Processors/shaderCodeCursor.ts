import { ShaderLanguage } from "../../Materials/shaderLanguage";

const LexicalStateRegex = /[()]|\/\/|\/\*/;
const CommentTokenRegex = /\/\*|\*\/|\/\//g;
const LexicalTokenRegex = /\/\*|\*\/|\/\/|[();]/g;

function PushSemicolonSeparatedLine(output: string[], line: string, trimmedLine: string): void {
    const semicolonIndex = trimmedLine.indexOf(";");

    if (semicolonIndex === -1) {
        output.push(trimmedLine);
    } else if (semicolonIndex === trimmedLine.length - 1) {
        if (trimmedLine.length > 1) {
            output.push(trimmedLine);
        }
    } else {
        const split = line.split(";");

        for (let index = 0; index < split.length; index++) {
            const subLine = split[index].trim();

            if (subLine) {
                output.push(subLine + (index !== split.length - 1 ? ";" : ""));
            }
        }
    }
}

/** @internal */
export class ShaderCodeCursor {
    private _lines: string[] = [];
    lineIndex: number;

    constructor(private readonly _shaderLanguage: ShaderLanguage = ShaderLanguage.GLSL) {}

    get currentLine(): string {
        return this._lines[this.lineIndex];
    }

    get canRead(): boolean {
        return this.lineIndex < this._lines.length - 1;
    }

    set lines(value: string[]) {
        this._lines.length = 0;
        let parenthesesDepth = 0;
        let blockCommentDepth = 0;

        for (const line of value) {
            // Skip empty lines
            if (!line || line === "\r") {
                continue;
            }

            // Prevent removing line break in macros.
            if (line[0] === "#") {
                if (line.indexOf("/") !== -1) {
                    CommentTokenRegex.lastIndex = 0;
                    let commentMatch: RegExpExecArray | null;

                    while ((commentMatch = CommentTokenRegex.exec(line))) {
                        const token = commentMatch[0];

                        if (token === "//" && blockCommentDepth === 0) {
                            break;
                        } else if (token === "/*" && (blockCommentDepth === 0 || this._shaderLanguage === ShaderLanguage.WGSL)) {
                            blockCommentDepth++;
                        } else if (token === "*/" && blockCommentDepth > 0) {
                            blockCommentDepth--;
                        }
                    }
                }

                this._lines.push(line);
                continue;
            }

            // Do not split single line comments
            const trimmedLine = line.trim();

            if (!trimmedLine) {
                continue;
            }

            if (blockCommentDepth === 0 && trimmedLine.startsWith("//")) {
                this._lines.push(line);
                continue;
            }

            // Keep the common case on the faster native string operations when no lexical state can change.
            if (blockCommentDepth === 0 && !LexicalStateRegex.test(line)) {
                if (parenthesesDepth > 0) {
                    this._lines.push(trimmedLine);
                } else {
                    PushSemicolonSeparatedLine(this._lines, line, trimmedLine);
                }
                continue;
            }

            // Split statements while preserving semicolons inside parenthesized expressions (such as for-loop headers).
            let subLineStart = 0;
            LexicalTokenRegex.lastIndex = 0;
            let match: RegExpExecArray | null;

            while ((match = LexicalTokenRegex.exec(line))) {
                const token = match[0];
                const index = match.index;

                if (blockCommentDepth > 0) {
                    if (this._shaderLanguage === ShaderLanguage.WGSL && token === "/*") {
                        blockCommentDepth++;
                    } else if (token === "*/") {
                        blockCommentDepth--;
                    }
                    continue;
                }

                if (token === "//") {
                    break;
                }

                if (token === "/*") {
                    blockCommentDepth++;
                    continue;
                }

                if (token === "(") {
                    parenthesesDepth++;
                } else if (token === ")" && parenthesesDepth > 0) {
                    parenthesesDepth--;
                } else if (token === ";" && parenthesesDepth === 0) {
                    const subLine = line.substring(subLineStart, index + 1).trim();

                    // If subLine == ";", we must not push, to be backward compatible with the old code!
                    if (subLine.length > 1) {
                        this._lines.push(subLine);
                    }
                    subLineStart = index + 1;
                }
            }

            const remainingLine = line.substring(subLineStart).trim();
            if (remainingLine) {
                this._lines.push(remainingLine);
            }
        }
    }
}
