import "core/Meshes/instancedMesh";
import { NullEngine } from "core/Engines/nullEngine";
import { type Effect } from "core/Materials/effect";
import { Buffer } from "core/Buffers/buffer";
import { Color4 } from "core/Maths/math.color";
import { Vector3 } from "core/Maths/math.vector";
import { MeshBuilder } from "core/Meshes/meshBuilder";
import { type Mesh } from "core/Meshes/mesh";
import { Scene } from "core/scene";
import { vi } from "vitest";

const BufferKind = "instanceColor";
const Stride = 4;

const createPerPassCustomBuffers = (source: Mesh, engine: NullEngine) => {
    source._instanceDataStorage.useMonoDataStorageRenderPass = false;
    source.registerInstancedBuffer(BufferKind, Stride);
    source.instancedBuffers[BufferKind] = new Color4(1, 1, 1, 1);
    const instance = source.createInstance("instance");

    engine.currentRenderPassId = 0;
    source._processInstancedBuffers([instance], true);
    const firstPassStorage = source._getInstanceDataStorage();
    const firstPassBuffer = firstPassStorage.instanceVertexBuffers[BufferKind]!;

    engine.currentRenderPassId = 1;
    source._processInstancedBuffers([instance], true);
    const secondPassStorage = source._getInstanceDataStorage();
    const secondPassBuffer = secondPassStorage.instanceVertexBuffers[BufferKind]!;

    return { firstPassStorage, secondPassStorage, firstPassBuffer, secondPassBuffer, instance };
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
        const firstPassStorage = source._getInstanceDataStorage();
        const firstPassBuffer = firstPassStorage.instanceVertexBuffers[BufferKind]!;

        engine.currentRenderPassId = 1;
        source._processInstancedBuffers(instances.slice(0, 1), true);
        const secondPassStorage = source._getInstanceDataStorage();
        const secondPassBuffer = secondPassStorage.instanceVertexBuffers[BufferKind]!;

        engine.currentRenderPassId = 0;
        source._processInstancedBuffers(instances, true);

        const resizedData = source._userInstancedBuffersStorage.data[BufferKind];
        const resizedFirstPassBuffer = firstPassStorage.instanceVertexBuffers[BufferKind]!;
        expect(resizedData.length).toBe(Stride * 64);
        expect(firstPassBuffer.isDisposed).toBe(true);
        expect(secondPassBuffer.isDisposed).toBe(true);
        expect(resizedFirstPassBuffer).not.toBe(firstPassBuffer);
        expect(resizedFirstPassBuffer.getData()).toBe(resizedData);
        expect(secondPassStorage.instanceVertexBuffers[BufferKind]).toBeUndefined();

        engine.currentRenderPassId = 1;
        source._processInstancedBuffers(instances, true);

        const resizedSecondPassBuffer = secondPassStorage.instanceVertexBuffers[BufferKind]!;
        expect(resizedSecondPassBuffer).not.toBe(secondPassBuffer);
        expect(resizedSecondPassBuffer.getData()).toBe(resizedData);
    });

    test("resizing keeps the single shared render-pass storage path for non-WebGPU engines", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        source.registerInstancedBuffer(BufferKind, Stride);
        source.instancedBuffers[BufferKind] = new Color4(1, 1, 1, 1);
        const renderPassStorage = source._getInstanceDataStorage();
        const initialBuffer = renderPassStorage.instanceVertexBuffers[BufferKind]!;
        const instances = Array.from({ length: 32 }, (_, index) => source.createInstance(`instance-${index}`));

        source._processInstancedBuffers(instances, true);

        const resizedData = source._userInstancedBuffersStorage.data[BufferKind];
        const resizedBuffer = renderPassStorage.instanceVertexBuffers[BufferKind]!;
        expect(initialBuffer.isDisposed).toBe(true);
        expect(resizedBuffer).not.toBe(initialBuffer);
        expect(resizedBuffer.getData()).toBe(resizedData);
        expect(source._getInstanceDataStorage()).toBe(renderPassStorage);
        expect(source._instanceDataStorage.renderPasses).toEqual({});
    });

    test("introspection does not create a render-pass storage", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        source._instanceDataStorage.useMonoDataStorageRenderPass = false;
        source.registerInstancedBuffer(BufferKind, Stride);

        expect(source.isVerticesDataPresent(BufferKind)).toBe(true);
        expect(source.getVerticesDataKinds()).toContain(BufferKind);
        expect(source.getVertexBuffer(BufferKind)).toBeUndefined();
        expect(source._instanceDataStorage.renderPasses).toEqual({});
    });

    test("re-registering a kind invalidates its buffers in every render pass", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        const { firstPassStorage, secondPassStorage, firstPassBuffer, secondPassBuffer } = createPerPassCustomBuffers(source, engine);

        source.registerInstancedBuffer(BufferKind, Stride * 2);

        expect(firstPassBuffer.isDisposed).toBe(true);
        expect(secondPassBuffer.isDisposed).toBe(true);
        expect(firstPassStorage.instanceVertexBuffers[BufferKind]).toBeUndefined();
        expect(secondPassStorage.instanceVertexBuffers[BufferKind]).toBeUndefined();
        expect(source._userInstancedBuffersStorage.strides[BufferKind]).toBe(Stride * 2);
    });

    test("removing a kind clears its CPU state and every render-pass buffer", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        const { firstPassStorage, secondPassStorage, firstPassBuffer, secondPassBuffer, instance } = createPerPassCustomBuffers(source, engine);

        source._removeInstancedBuffer(BufferKind);

        expect(firstPassBuffer.isDisposed).toBe(true);
        expect(secondPassBuffer.isDisposed).toBe(true);
        expect(firstPassStorage.instanceVertexBuffers[BufferKind]).toBeUndefined();
        expect(secondPassStorage.instanceVertexBuffers[BufferKind]).toBeUndefined();
        expect(source._userInstancedBuffersStorage.data[BufferKind]).toBeUndefined();
        expect(source._userInstancedBuffersStorage.strides[BufferKind]).toBeUndefined();
        expect(source._userInstancedBuffersStorage.sizes[BufferKind]).toBeUndefined();
        expect(BufferKind in source.instancedBuffers).toBe(false);
        expect(BufferKind in instance.instancedBuffers).toBe(false);
    });

    test("releasing a render pass disposes only the buffers owned by that pass", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        const { firstPassStorage, secondPassStorage, firstPassBuffer, secondPassBuffer } = createPerPassCustomBuffers(source, engine);
        const firstPassMatrixBuffer = new Buffer(engine, new Float32Array(16), true, 16, false, true);
        const secondPassMatrixBuffer = new Buffer(engine, new Float32Array(16), true, 16, false, true);
        const firstPassWorld0 = firstPassMatrixBuffer.createVertexBuffer("world0", 0, 4);
        const secondPassWorld0 = secondPassMatrixBuffer.createVertexBuffer("world0", 0, 4);
        firstPassStorage.instancesBuffer = firstPassMatrixBuffer;
        firstPassStorage.instanceVertexBuffers.world0 = firstPassWorld0;
        secondPassStorage.instancesBuffer = secondPassMatrixBuffer;
        secondPassStorage.instanceVertexBuffers.world0 = secondPassWorld0;

        source._releaseRenderPassId(1);

        expect(firstPassBuffer.isDisposed).toBe(false);
        expect(firstPassMatrixBuffer.isDisposed).toBe(false);
        expect(firstPassWorld0.isDisposed).toBe(false);
        expect(secondPassBuffer.isDisposed).toBe(true);
        expect(secondPassMatrixBuffer.isDisposed).toBe(true);
        expect(secondPassWorld0.isDisposed).toBe(true);
        expect(source._instanceDataStorage.renderPasses[0].instanceVertexBuffers[BufferKind]).toBe(firstPassBuffer);
        expect(source._instanceDataStorage.renderPasses[0].instanceVertexBuffers.world0).toBe(firstPassWorld0);
        expect(source._instanceDataStorage.renderPasses[1]).toBeUndefined();
    });

    test("recreating matrix buffers preserves custom buffers in the render pass", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        source._instanceDataStorage.useMonoDataStorageRenderPass = false;
        source.registerInstancedBuffer(BufferKind, Stride);
        source.instancedBuffers[BufferKind] = new Color4(1, 1, 1, 1);
        const instance = source.createInstance("instance");
        instance.instancedBuffers[BufferKind] = new Color4(0, 1, 0, 1);

        source._registerInstanceForRenderId(instance, scene.getRenderId());
        const batch = source._getInstancesRenderList(0);
        batch.renderSelf[0] = true;
        const storage = batch.parent;
        storage.instancesData = new Float32Array(storage.instancesBufferSize / Float32Array.BYTES_PER_ELEMENT);

        source._updateInstancedBuffers(source.subMeshes[0], batch, storage.instancesBufferSize, engine);

        const oldInstancesBuffer = storage.instancesBuffer!;
        const customBuffer = storage.instanceVertexBuffers[BufferKind]!;
        const oldBufferSize = storage.instancesBufferSize;
        storage.instancesBufferSize *= 2;
        storage.instancesData = new Float32Array(storage.instancesBufferSize / Float32Array.BYTES_PER_ELEMENT);

        source._updateInstancedBuffers(source.subMeshes[0], batch, oldBufferSize, engine);

        expect(oldInstancesBuffer.isDisposed).toBe(true);
        expect(storage.instancesBuffer).not.toBe(oldInstancesBuffer);
        expect(storage.instanceVertexBuffers[BufferKind]).toBe(customBuffer);
        expect(customBuffer.isDisposed).toBe(false);
    });

    test("disposing a mesh releases every render-pass custom buffer exactly once", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        const { firstPassBuffer, secondPassBuffer } = createPerPassCustomBuffers(source, engine);
        const firstDispose = vi.spyOn(firstPassBuffer, "dispose");
        const secondDispose = vi.spyOn(secondPassBuffer, "dispose");

        source.dispose();

        expect(firstDispose).toHaveBeenCalledTimes(1);
        expect(secondDispose).toHaveBeenCalledTimes(1);
        expect(source._instanceDataStorage.renderPasses).toEqual({});
    });

    test("disposing a WebGPU mesh without custom instance storage does not throw", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        source._instanceDataStorage.useMonoDataStorageRenderPass = false;

        expect(() => source.dispose()).not.toThrow();
    });

    test("rebuilding after device loss forgets every custom buffer without disposing it", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        const { firstPassStorage, secondPassStorage, firstPassBuffer, secondPassBuffer, instance } = createPerPassCustomBuffers(source, engine);

        source._rebuild();

        expect(firstPassBuffer.isDisposed).toBe(false);
        expect(secondPassBuffer.isDisposed).toBe(false);
        expect(firstPassStorage.instanceVertexBuffers).toEqual({});
        expect(secondPassStorage.instanceVertexBuffers).toEqual({});

        engine.currentRenderPassId = 0;
        source._processInstancedBuffers([instance], true);
        expect(firstPassStorage.instanceVertexBuffers[BufferKind]).not.toBe(firstPassBuffer);

        firstPassBuffer.dispose();
        secondPassBuffer.dispose();
    });

    test("rebuilding with disposal releases every custom buffer", () => {
        const source = MeshBuilder.CreateBox("source", {}, scene);
        const { firstPassStorage, secondPassStorage, firstPassBuffer, secondPassBuffer } = createPerPassCustomBuffers(source, engine);

        source._rebuild(true);

        expect(firstPassBuffer.isDisposed).toBe(true);
        expect(secondPassBuffer.isDisposed).toBe(true);
        expect(firstPassStorage.instanceVertexBuffers).toEqual({});
        expect(secondPassStorage.instanceVertexBuffers).toEqual({});
    });

    test("LinesMesh binds only the current render pass instance buffers", () => {
        const source = MeshBuilder.CreateLines("source", { points: [Vector3.Zero(), Vector3.One()] }, scene);
        source._instanceDataStorage.useMonoDataStorageRenderPass = false;
        source.registerInstancedBuffer(BufferKind, Stride);
        source.instancedBuffers[BufferKind] = new Color4(1, 1, 1, 1);
        const instance = source.createInstance("instance");

        engine.currentRenderPassId = 0;
        source._processInstancedBuffers([instance], true);
        const firstPassStorage = source._getInstanceDataStorage();

        engine.currentRenderPassId = 1;
        source._processInstancedBuffers([instance], true);
        const secondPassStorage = source._getInstanceDataStorage();
        const bind = vi.spyOn(source.geometry!, "_bind");

        source._bind(source.subMeshes[0], { setColor4: vi.fn() } as unknown as Effect);

        expect(bind).toHaveBeenCalledWith(expect.anything(), expect.anything(), secondPassStorage.instanceVertexBuffers, undefined);
        expect(secondPassStorage.instanceVertexBuffers).not.toBe(firstPassStorage.instanceVertexBuffers);
    });
});
