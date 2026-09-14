import { test, expect } from "@playwright/test";
import { evaluateCreateScene, evaluateDisposeEngine, evaluateInitEngine, getGlobalConfig } from "@tools/test-tools";

test.describe("InstancedMesh custom buffers", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(getGlobalConfig().baseUrl + "/empty.html", { waitUntil: "load", timeout: 0 });
        await page.waitForSelector("#babylon-canvas", { timeout: 20000 });
        await page.waitForFunction(() => window.BABYLON);
        await page.evaluate(evaluateInitEngine, { engineName: "webgpu" });
        await page.evaluate(evaluateCreateScene);
    });

    test.afterEach(async ({ page }) => {
        await page.evaluate(evaluateDisposeEngine);
    });

    test("resizes custom buffers used by multiple render passes without WebGPU validation errors", async ({ page }) => {
        const result = await page.evaluate(async () => {
            const B = window.BABYLON;
            const engine = window.engine as BABYLON.WebGPUEngine;
            const scene = window.scene!;
            const device = (engine as unknown as { _device: GPUDevice })._device;
            const renderFrame = async () => {
                engine.beginFrame();
                scene.render();
                engine.endFrame();
                await device.queue.onSubmittedWorkDone();
            };

            const camera = new B.FreeCamera("camera", new B.Vector3(0, 0, -10), scene);
            camera.setTarget(B.Vector3.Zero());
            scene.activeCamera = camera;

            const source = B.MeshBuilder.CreatePlane("source", { size: 0.2 }, scene);
            source.isVisible = false;
            source.registerInstancedBuffer("color", 4);
            source.instancedBuffers["color"] = new B.Color4(1, 1, 1, 1);

            const material = new B.StandardMaterial("material", scene);
            material.disableLighting = true;
            material.emissiveColor = B.Color3.White();
            source.material = material;

            new B.GlowLayer("glow", scene);

            const createInstance = (index: number) => {
                const instance = source.createInstance(`instance-${index}`);
                instance.position.set((index % 8) * 0.3 - 1, Math.floor(index / 8) * 0.3 - 0.6, 0);
                instance.instancedBuffers["color"] = new B.Color4(1, index / 40, 0.5, 1);
            };

            for (let index = 0; index < 8; index++) {
                createInstance(index);
            }

            await scene.whenReadyAsync();
            await renderFrame();

            const storage = source._userInstancedBuffersStorage;
            const initialRenderPassIds = Object.keys(storage.renderPasses ?? {});

            for (let index = 8; index < 40; index++) {
                createInstance(index);
            }

            device.pushErrorScope("validation");
            await renderFrame();
            const validationError = await device.popErrorScope();
            const capacities = Object.values(storage.renderPasses ?? {})
                .map((vertexBuffers) => vertexBuffers["color"]?.getBuffer()?.capacity)
                .filter((capacity): capacity is number => capacity !== undefined);

            return {
                validationError: validationError?.message,
                initialRenderPassCount: initialRenderPassIds.length,
                resizedDataByteLength: storage.data["color"].byteLength,
                capacities,
            };
        });

        expect(result.initialRenderPassCount).toBeGreaterThanOrEqual(2);
        expect(result.validationError).toBeUndefined();
        expect(result.capacities.length).toBeGreaterThanOrEqual(2);
        expect(result.capacities.every((capacity) => capacity === result.resizedDataByteLength)).toBe(true);
    });
});
