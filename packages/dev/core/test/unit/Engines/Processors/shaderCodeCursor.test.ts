import { ShaderCodeCursor } from "core/Engines/Processors/shaderCodeCursor";
import { Process } from "core/Engines/Processors/shaderProcessor";
import { type _IProcessingOptions } from "core/Engines/Processors/shaderProcessingOptions";
import { ShaderLanguage } from "core/Materials/shaderLanguage";
import { describe, expect, it } from "vitest";

function readLines(sourceLines: string[]): string[] {
    const cursor = new ShaderCodeCursor();
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
    it.each(["for(;;)", "for (;;)", "for (;true;)", "for (var i = 1;;)", "for (;;i++)", "for (var i = 1; i < 4; i++)"])(
        "preserves semicolons in a for-loop header: %s",
        (header) => {
            expect(readLines([header])).toEqual([header]);
        }
    );

    it("preserves semicolons in a multiline for-loop header", () => {
        expect(readLines(["for (", ";", ";", ")"])).toEqual(["for (", ";", ";", ")"]);
    });

    it("continues to split statements at top-level semicolons", () => {
        expect(readLines(["first(); second();"])).toEqual(["first();", "second();"]);
    });

    it("continues to discard an isolated top-level semicolon", () => {
        expect(readLines([";", "first(); ; second();"])).toEqual(["first();", "second();"]);
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
