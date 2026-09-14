import { ShaderLanguage } from "../../Materials/shaderLanguage";

const PreprocessorDirectiveRegex = /^#(if|ifdef|ifndef|elif|else|endif)\b/;
const LexicalStateRegex = /[()]|\/\/|\/\*/;
const CommentTokenRegex = /\/\*|\*\/|\/\//g;
const LexicalTokenRegex = /\/\*|\*\/|\/\/|[();]/g;

interface IConditionalParenthesesState {
    startDepth: number;
    branchDepths: number[];
    hasElse: boolean;
}

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
        const conditionalParenthesesStates: IConditionalParenthesesState[] = [];

        for (const line of value) {
            // Skip empty lines
            if (!line || line === "\r") {
                continue;
            }

            const trimmedLine = line.trim();

            if (!trimmedLine) {
                continue;
            }

            if (blockCommentDepth === 0 && trimmedLine[0] === "#") {
                const directive = PreprocessorDirectiveRegex.exec(trimmedLine)?.[1];

                if (directive === "if" || directive === "ifdef" || directive === "ifndef") {
                    conditionalParenthesesStates.push({ startDepth: parenthesesDepth, branchDepths: [], hasElse: false });
                } else if ((directive === "else" || directive === "elif") && conditionalParenthesesStates.length > 0) {
                    const conditionalState = conditionalParenthesesStates[conditionalParenthesesStates.length - 1];
                    conditionalState.branchDepths.push(parenthesesDepth);
                    conditionalState.hasElse ||= directive === "else";
                    parenthesesDepth = conditionalState.startDepth;
                } else if (directive === "endif" && conditionalParenthesesStates.length > 0) {
                    const conditionalState = conditionalParenthesesStates.pop()!;
                    conditionalState.branchDepths.push(parenthesesDepth);

                    // A conditional without an else also has an implicit branch that leaves the depth unchanged.
                    if (!conditionalState.hasElse) {
                        conditionalState.branchDepths.push(conditionalState.startDepth);
                    }

                    const branchDepth = conditionalState.branchDepths[0];
                    parenthesesDepth = conditionalState.branchDepths.every((depth) => depth === branchDepth) ? branchDepth : conditionalState.startDepth;
                }

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

                // Prevent removing line breaks in preprocessor directives while preserving the historical trimming of indented directives.
                this._lines.push(line[0] === "#" ? line : trimmedLine);
                continue;
            }

            // Do not split single line comments
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
