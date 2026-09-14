import "core/Meshes/instancedMesh";
import { NullEngine } from "core/Engines/nullEngine";
import { Color4 } from "core/Maths/math.color";
import { MeshBuilder } from "core/Meshes/meshBuilder";
import type { Mesh } from "core/Meshes/mesh";
import { Scene } from "core/scene";

const BufferKind = "instanceColor";
const Stride = 4;

const createPerPassCustomBuffers = (source: Mesh, engine: NullEngine) => {
    source._instanceDataStorage.useMonoDataStorageRenderPass = false;
    source.registerInstancedBuffer(BufferKind, Stride);
    source.instancedBuffers[BufferKind] = new Color4(1, 1, 1, 1);
    const instance = source.createInstance("instance");

    engine.currentRenderPassId = 0;
    source._processInstancedBuffers([instance], true);
    const firstPassBuffer = source._userInstancedBuffersStorage.renderPasses![0][BufferKind]!;

    engine.currentRenderPassId = 1;
    source._processInstancedBuffers([instance], true);
    const secondPassBuffer = source._userInstancedBuffersStorage.renderPasses![1][BufferKind]!;

    // _bindDirect exposes the current pass buffer through vertexBuffers when rendering.
    source._userInstancedBuffersStorage.vertexBuffers[BufferKind] = secondPassBuffer;

    return { firstPassBuffer, secondPassBuffer, instance };
};

describe("InstancedMesh custom buffers", () => {
    let engine: NullEngine;
    let scene: Scene;

    beforeEach(() => {
        engine = new NullEngine();
        scene = new Scene(engine);
    });

    afterEach(() => {
        scene.dispose();
        engine.dispose();
    });

    test("resizing invalidates the custom buffer in every render pass", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        source._instanceDataStorage.useMonoDataStorageRenderPass = false;
        source.registerInstancedBuffer(BufferKind, Stride);
        source.instancedBuffers[BufferKind] = new Color4(1, 1, 1, 1);

        const instances = Array.from({ length: 32 }, (_, index) => {
            const instance = source.createInstance(`instance-${index}`);
            instance.instancedBuffers[BufferKind] = new Color4(index / 32, 0, 0, 1);
            return instance;
        });

        engine.currentRenderPassId = 0;
        source._processInstancedBuffers(instances.slice(0, 1), true);
        const firstPassBuffer = source._userInstancedBuffersStorage.renderPasses![0][BufferKind]!;

        engine.currentRenderPassId = 1;
        source._processInstancedBuffers(instances.slice(0, 1), true);
        const secondPassBuffer = source._userInstancedBuffersStorage.renderPasses![1][BufferKind]!;

        engine.currentRenderPassId = 0;
        source._processInstancedBuffers(instances, true);

        const resizedData = source._userInstancedBuffersStorage.data[BufferKind];
        const resizedFirstPassBuffer = source._userInstancedBuffersStorage.renderPasses![0][BufferKind]!;
        expect(resizedData.length).toBe(Stride * 64);
        expect(firstPassBuffer.isDisposed).toBe(true);
        expect(secondPassBuffer.isDisposed).toBe(true);
        expect(resizedFirstPassBuffer).not.toBe(firstPassBuffer);
        expect(resizedFirstPassBuffer.getData()).toBe(resizedData);
        expect(source._userInstancedBuffersStorage.renderPasses![1][BufferKind]).toBeUndefined();
        expect(source._userInstancedBuffersStorage.vertexBuffers[BufferKind]).toBeNull();

        engine.currentRenderPassId = 1;
        source._processInstancedBuffers(instances, true);

        const resizedSecondPassBuffer = source._userInstancedBuffersStorage.renderPasses![1][BufferKind]!;
        expect(resizedSecondPassBuffer).not.toBe(secondPassBuffer);
        expect(resizedSecondPassBuffer.getData()).toBe(resizedData);
    });

    test("resizing keeps the single shared buffer path for non-WebGPU engines", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        source.registerInstancedBuffer(BufferKind, Stride);
        source.instancedBuffers[BufferKind] = new Color4(1, 1, 1, 1);
        const initialBuffer = source._userInstancedBuffersStorage.vertexBuffers[BufferKind]!;
        const instances = Array.from({ length: 32 }, (_, index) => source.createInstance(`instance-${index}`));

        source._processInstancedBuffers(instances, true);

        const resizedData = source._userInstancedBuffersStorage.data[BufferKind];
        const resizedBuffer = source._userInstancedBuffersStorage.vertexBuffers[BufferKind]!;
        expect(initialBuffer.isDisposed).toBe(true);
        expect(resizedBuffer).not.toBe(initialBuffer);
        expect(resizedBuffer.getData()).toBe(resizedData);
        expect(source._userInstancedBuffersStorage.renderPasses).toBeUndefined();
    });

    test("disposing a mesh releases custom buffers owned by every render pass", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        const { firstPassBuffer, secondPassBuffer } = createPerPassCustomBuffers(source, engine);
        const storage = source._userInstancedBuffersStorage;

        source.dispose();

        expect(firstPassBuffer.isDisposed).toBe(true);
        expect(secondPassBuffer.isDisposed).toBe(true);
        expect(storage.renderPasses).toEqual({});
        expect(storage.vertexBuffers[BufferKind]).toBeNull();
    });

    test("disposing a WebGPU mesh without custom instance storage does not throw", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        source._instanceDataStorage.useMonoDataStorageRenderPass = false;

        expect(() => source.dispose()).not.toThrow();
    });

    test("rebuilding a mesh forgets every per-pass custom buffer without disposing after device loss", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        const { firstPassBuffer, secondPassBuffer, instance } = createPerPassCustomBuffers(source, engine);
        const storage = source._userInstancedBuffersStorage;

        source._rebuild();

        expect(firstPassBuffer.isDisposed).toBe(false);
        expect(secondPassBuffer.isDisposed).toBe(false);
        expect(storage.renderPasses).toEqual({});
        expect(storage.vertexBuffers[BufferKind]).toBeNull();

        engine.currentRenderPassId = 0;
        source._processInstancedBuffers([instance], true);
        expect(storage.renderPasses![0][BufferKind]).not.toBe(firstPassBuffer);

        firstPassBuffer.dispose();
        secondPassBuffer.dispose();
    });
});
