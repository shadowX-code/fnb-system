"""Run in Blender from the repository root. The probe grid and crease strokes use cabin-local metres."""
import math
import struct
from collections import defaultdict
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

assets = Path.cwd() / "src/features/space-station/assets"
bpy.ops.wm.read_factory_settings(use_empty=True)
for name in ("departments", "factory-junction", "factory-workcell"):
    bpy.ops.import_scene.gltf(filepath=str(assets / (name + ".glb")))

# Match the screen faces, side rails and projector of the four existing cutaways.
amber = (1.0, .50, .16)
cyan = (.055, .62, 1.0)
violet = (.59, .17, 1.0)
def lamp(x, y, z, rgb, power, reach):
    return Vector((x, y, z)), rgb, power, reach
rooms = [
    (["CommandCabin"], [
        lamp(.15, 1.77, .03, cyan, 1.65, 2.7),
        lamp(-2.5, 2.2, -2.0, cyan, 1.3, 2.6), lamp(2.4, 2.2, -2.0, cyan, 1.3, 2.6),
        lamp(-3.5, 2.65, -.6, amber, .80, 2.2), lamp(3.5, 2.65, -.6, amber, .80, 2.2)]),
    (["FinanceCabin"], [
        lamp(0, 2.0, -1.85, (.07, .60, .95), .95, 2.2),
        lamp(-2.18, 2.76, -.78, amber, 1.33, 2.45), lamp(2.22, 2.76, -.78, amber, 1.2, 2.35)]),
    (["FactoryCorner", "FactoryWorkcell"], [
        lamp(-2.65, 2.6, -1.15, amber, 1.25, 2.3), lamp(2.6, 2.6, -1.15, amber, 1.25, 2.3),
        lamp(-.48, 1.45, -1.59, cyan, .53, 1.45)]),
    (["MarketingCabin"], [
        lamp(1.9, 2.0, -1.48, violet, 1.7, 2.7), lamp(-1.65, 1.9, -1.65, violet, 1.15, 2.1),
        lamp(-2.6, 2.7, -.45, amber, .94, 2.2)])]
low = (-5.8, -1.0, -3.35)
high = (5.8, 4.5, 3.35)
nx, ny, nz = (32, 16, 20)
directions = []
for i in range(18):
    y = 2 * (i + .5) / 18 - 1
    r = math.sqrt(1 - y*y)
    phi = i * math.pi * (3 - math.sqrt(5))
    directions.append(Vector((r*math.cos(phi), y, r*math.sin(phi))))

def geometry(roots):
    points, tris = [], []
    strokes = set()
    for name in roots:
        root = bpy.data.objects[name]
        for obj in root.children_recursive:
            if obj.type != "MESH":
                continue
            mesh = obj.data
            base = len(points)
            for v in mesh.vertices:
                p = obj.matrix_world @ v.co
                points.append(Vector((p.x, p.z, -p.y)))
            normals = defaultdict(list)
            # Include static cabinet/hull creases; omit camera, robotic limbs and printed surfaces.
            ink = not any(k in obj.name for k in ("Mural", "Plaque", "Display", "Glass", "CameraHead", "Turret", "FixtureHead"))
            for f in mesh.polygons:
                a,b,c = (base+index for index in f.vertices)
                tris.append((a,b,c))
                if not ink:
                    continue
                direction = (points[b]-points[a]).cross(points[c]-points[a]).normalized()
                for u,v in ((a,b),(b,c),(c,a)):
                    if (points[u]-points[v]).length < .34:
                        continue
                    # UV and flat-normal seams can split the same physical edge in glTF.
                    q = tuple(tuple(round(axis*1000) for axis in points[idx]) for idx in (u,v))
                    normals[tuple(sorted(q))].append(direction)
            for edge, adjacent in normals.items():
                if len(adjacent) == 2 and -.1 < adjacent[0].dot(adjacent[1]) < .81:
                    strokes.add(edge)
    return BVHTree.FromPolygons(points, tris, all_triangles=True), sorted(strokes)

def probe(world, origin, lights):
    shade = 0
    for ray in directions:
        hit = world.ray_cast(origin, ray, 1.3)[3]
        if hit is not None:
            shade += (1-hit/1.3)**1.4
    rgb = [.0,.0,.0]
    for center, color, power, reach in lights:
        delta = center-origin
        dist = delta.length
        if dist > reach*1.9:
            continue
        # Sample the width of a practical. Partial visibility softens its penumbra.
        visible = 0
        for dx in (-.23, 0, .23):
            toward = delta+Vector((dx, 0, .06))
            blocker = world.ray_cast(origin, toward.normalized(), max(.01,toward.length-.08))[3]
            visible += 1 if blocker is None else .13
        strength = power*math.exp(-2.2*(dist/reach)**2)*visible/3
        for i in range(3):
            rgb[i] += color[i]*strength
    return bytes([round(min(1, math.sqrt(v/2.5))*255) for v in rgb] +
                 [round(255*(1-shade/len(directions)))])

probes = bytearray()
contours = bytearray()
for roots, lights in rooms:
    world, strokes = geometry(roots)
    for z in range(nz):
        for y in range(ny):
            for x in range(nx):
                p = Vector(tuple(lo + (hi-lo)*index/(dim-1)
                                 for lo,hi,index,dim in zip(low, high, (x,y,z), (nx,ny,nz))))
                probes.extend(probe(world,p,lights))
    contours.extend(struct.pack("<I", len(strokes)))
    for a,b in strokes:
        contours.extend(struct.pack("<6h", *a, *b))
    print(roots[0], "architectural ink strokes",len(strokes))
(assets/"cabin-lighting.bin").write_bytes(b"FXL1" + probes + contours)
print("Baked", len(probes), "irradiance bytes and",len(contours),"contour bytes")
