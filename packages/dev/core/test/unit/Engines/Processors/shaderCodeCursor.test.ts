import { ShaderCodeCursor } from "core/Engines/Processors/shaderCodeCursor";
import { Process } from "core/Engines/Processors/shaderProcessor";
import { type _IProcessingOptions } from "core/Engines/Processors/shaderProcessingOptions";
import { ShaderLanguage } from "core/Materials/shaderLanguage";
import { describe, expect, it } from "vitest";

function readLines(sourceLines: string[], shaderLanguage: ShaderLanguage): string[] {
    const cursor = new ShaderCodeCursor(shaderLanguage);
    const lines: string[] = [];

    cursor.lineIndex = -1;
    cursor.lines = sourceLines;

    while (cursor.canRead) {
        cursor.lineIndex++;
        lines.push(cursor.currentLine);
    }

    return lines;
}

function createProcessingOptions(): _IProcessingOptions {
    return {
        defines: [],
        indexParameters: {},
        isFragment: false,
        shouldUseHighPrecisionShader: true,
        supportsUniformBuffers: true,
        shadersRepository: "",
        includesShadersStore: {},
        processor: { shaderLanguage: ShaderLanguage.WGSL, noPrecision: true },
        version: "",
        platformName: "WEBGPU",
        processingContext: null,
        isNDCHalfZRange: true,
        useReverseDepthBuffer: false,
    };
}

describe("ShaderCodeCursor", () => {
    it.each(
        [
            ["WGSL", ShaderLanguage.WGSL, "var"],
            ["GLSL", ShaderLanguage.GLSL, "int"],
        ].flatMap(([languageName, shaderLanguage, declarationKeyword]) =>
            ["for(;;)", "for (;;)", "for (;true;)", `for (${declarationKeyword} i = 1;;)`, "for (;;i++)", `for (${declarationKeyword} i = 1; i < 4; i++)`].map(
                (header) => [languageName, header, shaderLanguage] as const
            )
        )
    )("preserves semicolons in a %s for-loop header: %s", (_languageName, header, shaderLanguage) => {
        expect(readLines([header], shaderLanguage)).toEqual([header]);
    });

    it("defaults to GLSL", () => {
        const cursor = new ShaderCodeCursor();
        const lines: string[] = [];

        cursor.lineIndex = -1;
        cursor.lines = ["/* outer comment containing /* as plain comment text */", "first(); second();"];

        while (cursor.canRead) {
            cursor.lineIndex++;
            lines.push(cursor.currentLine);
        }

        expect(lines).toEqual(["/* outer comment containing /* as plain comment text */", "first();", "second();"]);
    });

    it("preserves semicolons in a multiline for-loop header", () => {
        expect(readLines(["for (", ";", ";", ")"], ShaderLanguage.WGSL)).toEqual(["for (", ";", ";", ")"]);
    });

    it("continues to split statements at top-level semicolons", () => {
        expect(readLines(["first(); second();"], ShaderLanguage.WGSL)).toEqual(["first();", "second();"]);
    });

    it("continues to discard an isolated top-level semicolon", () => {
        expect(readLines([";", "first(); ; second();"], ShaderLanguage.WGSL)).toEqual(["first();", "second();"]);
    });

    it("ignores parentheses in indented preprocessor directives", () => {
        expect(readLines(["    #define OPEN (", "first(); second();"], ShaderLanguage.GLSL)).toEqual(["#define OPEN (", "first();", "second();"]);
    });

    it("tracks block comments that start on preprocessor directives", () => {
        expect(readLines(["#ifdef FOO", "foo();", "#endif /* explanation", "(", "*/", "first(); second();"], ShaderLanguage.GLSL)).toEqual([
            "#ifdef FOO",
            "foo();",
            "#endif /* explanation",
            "(",
            "*/",
            "first();",
            "second();",
        ]);
    });

    it("does not accumulate parenthesis depth across preprocessor branches", () => {
        expect(readLines(["#ifdef USE_FOO", "foo(", "#else", "bar(", "#endif", "x);", "first(); second();"], ShaderLanguage.WGSL)).toEqual([
            "#ifdef USE_FOO",
            "foo(",
            "#else",
            "bar(",
            "#endif",
            "x);",
            "first();",
            "second();",
        ]);
    });

    it.each([
        ["an else branch", ["#ifdef USE_FOO", "foo();", "#else", "bar(", "#endif"]],
        ["an elif branch", ["#if USE_FOO", "foo();", "#elif USE_BAR", "bar(", "#else", "baz();", "#endif"]],
        ["an if branch without an else", ["#ifdef USE_FOO", "foo(", "#endif"]],
    ])("does not propagate mismatched parenthesis depth from %s", (_description, conditionalLines) => {
        expect(readLines([...conditionalLines, "first(); second();"], ShaderLanguage.WGSL)).toEqual([...conditionalLines, "first();", "second();"]);
    });

    it("processes declarations separately after asymmetric preprocessor branches", () => {
        const processedUniforms: string[] = [];
        const options = createProcessingOptions();
        options.defines.push("#define USE_FOO");
        options.processor = {
            ...options.processor,
            uniformRegexp: /^uniform/,
            uniformProcessor: (line) => {
                processedUniforms.push(line);
                return line;
            },
        };

        Process("#ifdef USE_FOO\nfoo();\n#else\nbar(\n#endif\nuniform first: f32; uniform second: f32;", options, () => {});

        expect(processedUniforms).toEqual(["uniform first: f32;", "uniform second: f32;"]);
    });

    it("ignores parentheses in nested block comments", () => {
        expect(readLines(["/* outer", "/* inner */", "(", "*/", "first(); second();"], ShaderLanguage.WGSL)).toEqual([
            "/* outer",
            "/* inner */",
            "(",
            "*/",
            "first();",
            "second();",
        ]);
    });

    it("does not nest GLSL block comments", () => {
        expect(readLines(["/* outer comment containing /* as plain comment text */", "first(); second();"], ShaderLanguage.GLSL)).toEqual([
            "/* outer comment containing /* as plain comment text */",
            "first();",
            "second();",
        ]);
    });

    it.each([
        ["a line comment marker", ["/*", "// */", "first(); second();"]],
        ["a preprocessor directive", ["/*", "#define WHATEVER */", "first(); second();"]],
    ])("recognizes a block comment terminator after %s", (_description, sourceLines) => {
        expect(readLines(sourceLines, ShaderLanguage.WGSL)).toEqual([...sourceLines.slice(0, -1), "first();", "second();"]);
    });

    it("preserves valid WGSL loop headers through shader preprocessing", () => {
        const source = `@compute @workgroup_size(1)
fn main() {
    for (;;) {
        break;
    }
    for (var i = 1;;) {
        break;
    }
    var j = 0;
    for (;;j++) {
        break;
    }
}`;
        const options = createProcessingOptions();
        let processed = "";

        Process(source, options, (migratedCode) => (processed = migratedCode));

        expect(processed).toBe(`@compute @workgroup_size(1)
fn main() {
for (;;) {
break;
}
for (var i = 1;;) {
break;
}
var j = 0;
for (;;j++) {
break;
}
}
`);
    });
});
