"""Bake the Factory deck and rear liner from the two shipped GLBs. Run in Blender from the repository root."""
import math
import struct
import zlib
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

assets = Path.cwd() / "src/features/space-station/assets"
bpy.ops.wm.read_factory_settings(use_empty=True)
for name in ("factory-junction", "factory-workcell"):
    bpy.ops.import_scene.gltf(filepath=str(assets / (name + ".glb")))

verts, faces, liners = [], [], []
excluded = {node for name in ("RingSector", "BridgeCollar") for node in bpy.data.objects[name].children_recursive}
for obj in bpy.context.scene.objects:
    if obj.type != "MESH" or obj in excluded:
        continue
    start = len(verts)
    for vertex in obj.data.vertices:
        p = obj.matrix_world @ vertex.co
        verts.append((p.x, p.z, -p.y))
    for poly in obj.data.polygons:
        face = tuple(start + i for i in poly.vertices)
        faces.append(face)
        if obj.material_slots[poly.material_index].name == "Painted cabin liner":
            liners.append(face)

world = BVHTree.FromPolygons(verts, faces)
rear_wall = BVHTree.FromPolygons(verts, liners)
samples = 64
directions = []
for i in range(samples):
    radius = math.sqrt((i + .5) / samples)
    phi = i * math.pi * (3 - math.sqrt(5))
    directions.append((radius * math.cos(phi), math.sqrt(1 - radius * radius), radius * math.sin(phi)))

def visibility(origin, rays):
    occlusion = 0
    for ray in rays:
        _, _, _, distance = world.ray_cast(origin, ray, 2.0)
        if distance is not None:
            occlusion += (1 - distance / 2.0) ** 1.35
    return round(255 * (1 - occlusion / samples))

# Coordinates match the two projected UV islands installed on the original meshes.
w, h = 192, 224
deck_rays = [Vector(d) for d in directions]
wall_rays = [Vector((x, z, y)) for x, y, z in directions]
rows = []
for row in range(h):
    line = bytearray()
    for col in range(w):
        x = (col + .5) / w * 7.4 - 3.7
        if row < 128:
            z = (row + .5) / 128 * 4.8 - 2.45
            value = visibility(Vector((x, .024, z)), deck_rays)
        else:
            y = (h - row - .5) / 96 * 3.25
            hit, *_ = rear_wall.ray_cast(Vector((x, y, 2.4)), Vector((0, 0, -1)), 6)
            value = visibility(hit + Vector((0, 0, .028)), wall_rays) if hit is not None else 255
        line.append(value)
    rows.append(b"\x00" + line)

def chunk(tag, payload):
    return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload))

output = assets / "factory-occlusion.png"
output.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">II5B", w, h, 8, 0, 0, 0, 0))
                   + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))
print("Baked", len(faces), "occluder faces and", len(liners), "rear liner faces to", output)
