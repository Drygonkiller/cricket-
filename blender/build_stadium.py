"""Build the Super Over Smash stadium with Blender 4.x.

Plan: lay out the oval and pitch in metres, batch the terraces by material,
build the kit and articulated players, then light, validate, export and render.
Run: blender --background --factory-startup --python blender/build_stadium.py
"""

from math import cos, pi, sin
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SEGMENTS = 72
palette = {}


def material(name, color, roughness):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    palette[name] = mat
    return mat


def mesh(name, vertices, faces, colors, indices=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.validate()
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    for color in colors:
        data.materials.append(palette[color])
    if indices:
        for polygon, index in zip(data.polygons, indices):
            polygon.material_index = index
    return obj


def paint(obj, name, color):
    obj.name = name
    obj.data.materials.append(palette[color])
    return obj


def box(name, location, dimensions, color, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = paint(bpy.context.object, name, color)
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Edge chamfer", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


def limb(name, start, end, radius, color, sides=8):
    delta = Vector(end) - Vector(start)
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius, depth=delta.length,
                                       location=Vector(start) + delta / 2)
    obj = paint(bpy.context.object, name, color)
    obj.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    return obj


def facet(name, location, dimensions, color, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=location)
    obj = paint(bpy.context.object, name, color)
    obj.dimensions = dimensions
    return obj


def root(name, location=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.parent = parent
    return obj


def group_parts(parts, name, parent=None):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    obj = parts[0]
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.parent = parent
    return obj


def oval_mesh(name, profiles, colors, course_color, closed=False, segments=SEGMENTS):
    vertices = []
    for rx, ry, z in profiles:
        for i in range(segments):
            angle = 2 * pi * i / segments
            vertices.append((rx * cos(angle), ry * sin(angle), z))
    faces, indices = [], []
    courses = len(profiles) if closed else len(profiles) - 1
    for course in range(courses):
        inner = course * segments
        outer = ((course + 1) % len(profiles)) * segments
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((inner + i, outer + i, outer + j, inner + j))
            indices.append(course_color(course, i))
    return mesh(name, vertices, faces, colors, indices)


def stadium():
    # Turf uses alternating concentric mowing bands and a filled centre.
    bpy.ops.mesh.primitive_circle_add(vertices=SEGMENTS, radius=1, fill_type="NGON")
    centre = paint(bpy.context.object, "Turf_Centre", "Grass")
    centre.scale = (7.6, 9.2, 1)
    turf = [(25 * t, 30 * t, 0) for t in (.30, .44, .58, .72, .86, 1)]
    oval_mesh("Turf_Mowing_Bands", turf, ["Grass", "Grass Cut"], lambda c, i: c % 2)
    oval_mesh("Perimeter_Concourse", [(25, 30, -.025), (27.6, 32.6, -.025), (28, 33, .12)],
              ["Concrete", "Gold"], lambda c, i: c)
    profiles = [(28, 33, .12)]
    for level in range(12):
        x = 28 + level * .55
        y = 33 + level * .55
        z = .12 + level * .34
        profiles.extend([(x, y, z + .34), (x + .55, y + .55, z + .34)])

    def tier_color(course, section):
        if section % 9 in (0, 8):
            return 0
        if course % 2 == 0:
            return 1
        return 2 if (section // 9 + course // 9) % 2 else 3

    oval_mesh("Stands_Ring", profiles, ["Concrete", "Stand Shadow", "Teal Seats", "Blue Seats"], tier_color)
    edge = profiles[-1]
    oval_mesh("Upper_Fascia", [edge, (35.3, 40.3, edge[2]), (35.3, 40.3, 0),
                             (36.1, 41.1, -.08)],
              ["Concrete", "Stand Shadow", "Gold"], lambda c, i: (2, 1, 0)[c])
    oval_mesh("Boundary_Rope",
              [(24.1 + .085 * cos(2 * pi * j / 6), 29.1 + .085 * cos(2 * pi * j / 6),
                .105 + .075 * sin(2 * pi * j / 6)) for j in range(6)],
              ["Chalk", "Gold"], lambda c, i: int((i // 6) % 2 == 0), closed=True)
    box("Ground_Plinth", (0, 0, -.48), (75, 86, .7), "Stand Shadow", .25)
    screen = [box("Sight_Back", (0, 29.7, 1.65), (8.4, .38, 3.3), "Stand Shadow", .12),
              box("Sight_Panel", (0, 29.47, 1.75), (7.8, .12, 2.7), "Chalk", .04)]
    group_parts(screen, "Sightscreen")

    for index, (x, y) in enumerate([(-26, -30), (26, -30), (-26, 30), (26, 30)], 1):
        light = root(f"Floodlight_{index}")
        truss = []
        for side in (-1, 1):
            anchor = (x + side * .68, y, .18)
            top = (x + side * .37, y, 11.2)
            truss.append(limb("Mast", anchor, top, .11, "Steel", 6))
            for tier in range(5):
                a = (x + side * (.68 - tier * .062), y, .18 + tier * 2.204)
                b = (x - side * (.68 - (tier + 1) * .062), y, .18 + (tier + 1) * 2.204)
                truss.append(limb("Brace", a, b, .045, "Steel", 6))
        inward = -1 if y < 0 else 1
        truss.append(box("Lamp_Frame", (x, y, 11.4), (4.05, .6, 1.65), "Steel", .12))
        group_parts(truss, f"Floodlight_{index}_Frame", light)
        lamps = [box("Lens", (x + col * .70, y - inward * .35, 11.4 + row * .37),
                     (.52, .16, .26), "Lamp Ivory") for col in range(-2, 3) for row in (-1, 0, 1)]
        group_parts(lamps, f"Floodlight_{index}_Lenses", light)


def cricket_kit():
    box("Pitch", (0, 0, .028), (3.3, 21.2, .056), "Pitch Clay", .022)
    markings = []
    for end in (-1, 1):
        crease = end * 8.75
        markings.append(box("Popping_Crease", (0, crease, .058), (3, .062, .005), "Chalk"))
        markings.append(box("Bowling_Crease", (0, end * 10.06, .058), (2.68, .052, .005), "Chalk"))
        for side in (-1, 1):
            markings.append(box("Return_Crease", (side * 1.32, end * 9.43, .058),
                                (.065, 1.49, .005), "Chalk"))
        stumps = [limb("Stump", (x, end * 9.83, .056), (x, end * 9.83, .79), .036, "Ash", 8)
                  for x in (-.115, 0, .115)]
        for x in (-.0575, .0575):
            stumps.append(limb("Bail", (x - .065, end * 9.83, .8),
                               (x + .065, end * 9.83, .8), .024, "Gold", 8))
        group_parts(stumps, "Stumps_Batsman" if end > 0 else "Stumps_Bowler")
    markings.append(box("Strike_Line", (0, 8.73, .063), (2.9, .028, .006), "Gold"))
    group_parts(markings, "Pitch_Creases")
    ball = root("Cricket_Ball", (-.66, -10.66, 1.42))
    ball_body = facet("Ball_Body", (0, 0, 0), (.31, .31, .31), "Ball Red", 2)
    ball_body.parent = ball
    bpy.ops.mesh.primitive_torus_add(major_segments=20, minor_segments=4, major_radius=.148, minor_radius=.012)
    seam = paint(bpy.context.object, "Ball_Seam", "Chalk")
    seam.rotation_euler.x = pi * .33
    seam.parent = ball


def player(name, location, batting):
    rig = root(name, location)
    shirt = "Coral Jersey" if batting else "Mint Jersey"
    stance = .26 if batting else .20
    pieces = [box("Torso", (0, 0, 1.2), (.48, .29, .56), shirt, .068),
              box("Collar", (0, 0, 1.49), (.29, .23, .07), "Chalk", .02),
              facet("Face", (0, 0, 1.66), (.29, .28, .35), "Skin", 2),
              facet("Helmet" if batting else "Cap", (0, .018, 1.76), (.34, .34, .26), "Navy", 2),
              box("Peak", (0, -.17 if batting else .16, 1.73), (.28, .25, .05), "Navy", .018)]
    for side in (-1, 1):
        x = side * stance
        pieces.extend([limb("Thigh", (side * .12, 0, .96), (x, -.045, .49), .115, "Navy"),
                       limb("Shin", (x, -.045, .49), (x, 0, .15), .083, "Navy"),
                       box("Boot", (x, -.1 if batting else .10, .12), (.23, .32, .13), "Chalk", .02)])
        if batting:
            pieces += [box("Pad", (x, -.1, .39), (.19, .16, .47), "Pad", .033)]
        elbow = (.35 * side, -.07 if batting else -.15 * side, 1.23)
        hand = ((.29 if side > 0 else .10), -.34, 1.09) if batting else (side * .39, .17 * side, 1.39)
        pieces.extend([limb("Sleeve", (side * .19, 0, 1.39), elbow, .092, shirt),
                       limb("Forearm", elbow, hand, .064, "Skin"),
                       facet("Glove" if batting else "Hand", hand, (.16, .17, .15),
                             "Pad" if batting else "Skin")])
    group_parts(pieces, name + "_Mesh", rig)
    if batting:
        pivot = root("Bat_Pivot", (.23, -.34, 1.10), rig)
        body = [box("Blade", (.06, 0, -.39), (.235, .087, .68), "Ash", .021),
                limb("Handle", (0, 0, -.13), (0, 0, .17), .042, "Navy", 8),
                box("Blade_Accent", (.06, -.047, -.25), (.145, .012, .1), "Gold")]
        group_parts(body, "Cricket_Bat", pivot)
        pivot.rotation_euler.y = -.32


def point_at(obj, location):
    obj.rotation_euler = (Vector(location) - obj.location).to_track_quat("-Z", "Y").to_euler()


def light(name, location, color, power, size):
    data = bpy.data.lights.new(name, "AREA")
    data.color, data.energy, data.shape, data.size = color, power, "DISK", size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    point_at(obj, (0, 0, 0))


def presentation(scene):
    world = bpy.data.worlds.new("Hemisphere ambient")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.27, .40, .54, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = .44
    scene.world = world
    sun = bpy.data.lights.new("Warm key sun", "SUN")
    sun.energy, sun.angle, sun.color = 2.8, .12, (1, .88, .71)
    key = bpy.data.objects.new(sun.name, sun)
    bpy.context.collection.objects.link(key)
    key.location = (-25, -35, 40)
    point_at(key, (0, 0, 0))
    light("Cool bounce fill", (25, -30, 25), (.62, .83, 1), 8500, 34)
    light("Warm stadium rim", (0, 36, 23), (1, .73, .47), 11500, 32)
    camera = bpy.data.cameras.new("Broadcast stadium camera")
    camera.type = "ORTHO"
    camera.ortho_scale = 108
    cam = bpy.data.objects.new(camera.name, camera)
    bpy.context.collection.objects.link(cam)
    cam.location = (45, -62, 62)
    point_at(cam, (0, 0, 1))
    scene.camera = cam
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 20
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 1040
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name, color, roughness in [
        ("Grass", (.064, .255, .102), .91), ("Grass Cut", (.089, .32, .13), .91),
        ("Pitch Clay", (.66, .39, .21), .89), ("Concrete", (.19, .28, .30), .88),
        ("Stand Shadow", (.023, .060, .085), .76), ("Teal Seats", (.026, .27, .29), .68),
        ("Blue Seats", (.046, .14, .24), .68), ("Gold", (.96, .55, .125), .53),
        ("Chalk", (.91, .89, .76), .77), ("Steel", (.13, .23, .25), .54),
        ("Lamp Ivory", (.93, .98, .89), .34), ("Ash", (.77, .49, .25), .63),
        ("Ball Red", (.57, .038, .048), .42), ("Coral Jersey", (.64, .096, .11), .78),
        ("Mint Jersey", (.095, .57, .395), .78), ("Navy", (.023, .060, .119), .74),
        ("Skin", (.45, .237, .136), .78), ("Pad", (.73, .84, .78), .71),
    ]:
        material(name, color, roughness)
    stadium()
    cricket_kit()
    player("Player_Batsman", (-.54, 9.25, .056), True)
    player("Player_Bowler", (-.66, -11.2, .056), False)
    scene = bpy.context.scene
    presentation(scene)
    bpy.ops.object.select_all(action="DESELECT")
    total = 0
    for obj in sorted(scene.objects, key=lambda obj: obj.name):
        if obj.type != "MESH":
            continue
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        obj.select_set(False)
        obj.data.calc_loop_triangles()
        count = len(obj.data.loop_triangles)
        print(f"TRIANGLES {obj.name}: {count}", flush=True)
        total += count
    print(f"TOTAL_TRIANGLES {total}", flush=True)
    print("MATERIALS " + ", ".join(sorted(palette)), flush=True)
    if total >= 50_000:
        raise RuntimeError("Stadium exceeds 50,000 triangles")

    assets, renders = ROOT / "assets", ROOT / "renders"
    assets.mkdir(exist_ok=True)
    renders.mkdir(exist_ok=True)
    scene.render.filepath = "//../renders/stadium_preview.png"
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(assets / "cricket_stadium.blend"), compress=True)
    bpy.ops.export_scene.gltf(filepath=str(assets / "cricket_stadium.glb"), export_format="GLB",
                              export_yup=True, export_apply=True, export_texcoords=False,
                              export_animations=False, export_cameras=False, export_lights=False)
    scene.render.filepath = str(renders / "stadium_preview.png")
    bpy.ops.render.render(write_still=True)
    for output in [assets / "cricket_stadium.blend", assets / "cricket_stadium.glb", renders / "stadium_preview.png"]:
        size = output.stat().st_size
        if not size:
            raise RuntimeError(f"Empty output: {output}")
        print(f"OUTPUT {output.relative_to(ROOT)} {size} bytes", flush=True)


if __name__ == "__main__":
    main()
