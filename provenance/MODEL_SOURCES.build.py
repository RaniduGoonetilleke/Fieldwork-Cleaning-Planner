"""Build static display GLBs from licensed vendor robot meshes and URDF poses.

This is an asset-format conversion, not a physics model or a robot controller.
The displayed poses are selected for legibility and do not reproduce a trial.
"""
from pathlib import Path
import json, struct, math, hashlib, xml.etree.ElementTree as ET
import numpy as np

BASE=Path(__file__).resolve().parents[1]
MODELS=BASE/'public/models'
RAW=BASE/'provenance/MODEL_SOURCES.raw'
NS={'c':'http://www.collada.org/2005/11/COLLADASchema'}
SOURCES=[]

def record(path):
    path=Path(path)
    SOURCES.append({'path':str(path),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})

def rpy(v):
    r,p,y=v; cr,sr,cp,sp,cy,sy=math.cos(r),math.sin(r),math.cos(p),math.sin(p),math.cos(y),math.sin(y)
    m=np.eye(4);m[:3,:3]=np.array([[cy,-sy,0],[sy,cy,0],[0,0,1]])@np.array([[cp,0,sp],[0,1,0],[-sp,0,cp]])@np.array([[1,0,0],[0,cr,-sr],[0,sr,cr]])
    return m

def origin(e):
    if e is None:return np.eye(4)
    m=rpy([float(x) for x in e.attrib.get('rpy','0 0 0').split()]);m[:3,3]=[float(x) for x in e.attrib.get('xyz','0 0 0').split()];return m

def axisrot(axis,angle):
    axis=np.array(axis,dtype=float);axis/=np.linalg.norm(axis);x,y,z=axis;s,c=math.sin(angle),math.cos(angle);k=np.array([[0,-z,y],[z,0,-x],[-y,x,0]])
    m=np.eye(4);m[:3,:3]=np.eye(3)*c+(1-c)*np.outer(axis,axis)+s*k;return m

def normals_for(pos,indices):
    triangles=pos[indices.reshape(-1,3)];face=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0]);out=np.zeros_like(pos)
    for i in range(3):np.add.at(out,indices.reshape(-1,3)[:,i],face)
    n=np.linalg.norm(out,axis=1);out/=np.maximum(n,1e-12)[:,None];return out

def read_stl(path):
    record(path);data=Path(path).read_bytes();n=struct.unpack_from('<I',data,80)[0]
    assert len(data)==84+50*n,'Expected binary STL'
    dtype=np.dtype([('normal','<f4',(3,)),('vertices','<f4',(3,3)),('attribute','<u2')]);tri=np.frombuffer(data,dtype=dtype,offset=84,count=n)['vertices']
    pos,indices=np.unique(tri.reshape(-1,3),axis=0,return_inverse=True);normal=normals_for(pos,indices)
    return [(pos,normal,indices,None)]

def read_dae(path):
    record(path);root=ET.parse(path).getroot(); effects={}
    for e in root.findall('c:library_effects/c:effect',NS):
        c=e.find('.//c:diffuse/c:color',NS);effects[e.attrib['id']]=[float(x) for x in c.text.split()] if c is not None else [.6,.65,.68,1]
    materials={}
    for m in root.findall('c:library_materials/c:material',NS):materials[m.attrib['id']]=effects[m.find('c:instance_effect',NS).attrib['url'][1:]]
    geometries={g.attrib['id']:g for g in root.findall('c:library_geometries/c:geometry',NS)}
    primitives=[]
    for node in root.findall('.//c:visual_scene/c:node',NS):
        inst=node.find('c:instance_geometry',NS)
        if inst is None:continue
        bindings={x.attrib['symbol']:x.attrib['target'][1:] for x in inst.findall('.//c:instance_material',NS)}
        matrix=node.find('c:matrix',NS);transform=np.array([float(x) for x in matrix.text.split()]).reshape(4,4) if matrix is not None else np.eye(4)
        mesh=geometries[inst.attrib['url'][1:]].find('c:mesh',NS);sources={}
        for source in mesh.findall('c:source',NS):
            accessor=source.find('c:technique_common/c:accessor',NS);stride=int(accessor.attrib.get('stride','3'));sources[source.attrib['id']]=np.fromstring(source.find('c:float_array',NS).text,sep=' ').reshape(-1,stride)
        vertices={v.attrib['id']:v.find('c:input',NS).attrib['source'][1:] for v in mesh.findall('c:vertices',NS)}
        for tri in mesh.findall('c:triangles',NS):
            inputs=tri.findall('c:input',NS);stride=max(int(i.attrib['offset']) for i in inputs)+1;data=np.fromstring(tri.find('c:p',NS).text,sep=' ',dtype=np.int64).reshape(-1,stride)
            pos=None;norm=None
            for inp in inputs:
                source=inp.attrib['source'][1:];idx=data[:,int(inp.attrib['offset'])]
                if inp.attrib['semantic']=='VERTEX':pos=sources[vertices[source]][idx,:3]
                if inp.attrib['semantic']=='NORMAL':norm=sources[source][idx,:3]
            assert pos is not None
            if norm is None:norm=normals_for(pos,np.arange(len(pos)))
            joined=np.concatenate([pos,norm],axis=1).astype('<f4');unique,indices=np.unique(joined,axis=0,return_inverse=True)
            pos=unique[:,:3]@transform[:3,:3].T+transform[:3,3];norm=unique[:,3:]@np.linalg.inv(transform[:3,:3])
            color=materials.get(bindings.get(tri.attrib.get('material')), [.6,.65,.68,1])
            primitives.append((pos,norm,indices,color))
    return primitives

def write_glb(path,primitives,copyright_text):
    binary=bytearray();g={'asset':{'version':'2.0','generator':'Static URDF mesh conversion for the interactive display','copyright':copyright_text},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}],'meshes':[{'primitives':[]}],'materials':[],'buffers':[{}],'bufferViews':[],'accessors':[]}
    colors={}
    def accessor(array,kind,component,target):
        while len(binary)%4:binary.append(0)
        offset=len(binary);array=np.ascontiguousarray(array);binary.extend(array.tobytes());view=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':array.nbytes,'target':target})
        acc={'bufferView':view,'componentType':component,'count':len(array),'type':kind}
        if kind=='VEC3':acc.update(min=array.min(axis=0).tolist(),max=array.max(axis=0).tolist())
        i=len(g['accessors']);g['accessors'].append(acc);return i
    total=0
    for pos,norm,indices,color in primitives:
        pos=pos.astype('<f4');norm=norm.astype('<f4');norm/=np.maximum(np.linalg.norm(norm,axis=1),1e-12)[:,None];indices=indices.astype('<u4')
        color=tuple(round(float(x),6) for x in color)
        if color not in colors:
            colors[color]=len(g['materials']);g['materials'].append({'pbrMetallicRoughness':{'baseColorFactor':list(color),'metallicFactor':.32,'roughnessFactor':.38},'doubleSided':False})
        g['meshes'][0]['primitives'].append({'attributes':{'POSITION':accessor(pos,'VEC3',5126,34962),'NORMAL':accessor(norm,'VEC3',5126,34962)},'indices':accessor(indices,'SCALAR',5125,34963),'material':colors[color]});total+=len(indices)//3
    while len(binary)%4:binary.append(0)
    g['buffers'][0]['byteLength']=len(binary);encoded=json.dumps(g,separators=(',',':')).encode()
    while len(encoded)%4:encoded+=b' '
    data=struct.pack('<4sII',b'glTF',2,12+8+len(encoded)+8+len(binary))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(binary),b'BIN\0')+binary
    path.write_bytes(data)
    positions=np.concatenate([p[0] for p in primitives]);return {'file':str(path.relative_to(BASE)),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'triangles':total,'primitives':len(primitives),'bounds':[positions.min(axis=0).tolist(),positions.max(axis=0).tolist()]}

def build(urdf,name,angles,copyright_text):
    record(urdf);root=ET.parse(urdf).getroot();links={l.attrib['name']:l for l in root.findall('link')};jointmap={j.find('child').attrib['link']:j for j in root.findall('joint')};cache={};globalmats={}
    for m in root.findall('material'):globalmats[m.attrib['name']]=[float(x) for x in m.find('color').attrib['rgba'].split()]
    def link_transform(name):
        if name in cache:return cache[name]
        if name not in jointmap:cache[name]=np.eye(4);return cache[name]
        j=jointmap[name];m=link_transform(j.find('parent').attrib['link'])@origin(j.find('origin'))
        if j.attrib.get('type') in ['revolute','continuous']:
            axis=[float(x) for x in j.find('axis').attrib.get('xyz','1 0 0').split()];m=m@axisrot(axis,angles.get(j.attrib['name'],0))
        cache[name]=m;return m
    y_up=rpy([-math.pi/2,0,0]);out=[]
    for lname,link in links.items():
        for visual in link.findall('visual'):
            mesh=visual.find('geometry/mesh')
            if mesh is None:continue
            filename=mesh.attrib['filename']
            path=Path('/opt/ros/humble/share/ur_description')/filename.removeprefix('package://ur_description/') if filename.startswith('package://ur_description/') else Path(urdf).parent/filename
            transform=y_up@link_transform(lname)@origin(visual.find('origin'));scaling=np.diag([float(x) for x in mesh.attrib.get('scale','1 1 1').split()]+[1]);transform=transform@scaling
            primitives=read_stl(path) if path.suffix.lower()=='.stl' else read_dae(path)
            mat=visual.find('material');override=None
            if mat is not None:
                color=mat.find('color');override=[float(x) for x in color.attrib['rgba'].split()] if color is not None else globalmats.get(mat.attrib.get('name'))
            for pos,norm,indices,color in primitives:
                pos=pos@transform[:3,:3].T+transform[:3,3];norm=norm@np.linalg.inv(transform[:3,:3]);out.append((pos,norm,indices,color or override or [.62,.65,.66,1]))
    result=write_glb(MODELS/(name+'.glb'),out,copyright_text);result['display_joint_angles_radians']=angles;return result

if __name__=='__main__':
    angles={'shoulder_pan_joint':0,'shoulder_lift_joint':-1.25,'elbow_joint':1.8,'wrist_1_joint':-2.05,'wrist_2_joint':-1.57,'wrist_3_joint':0}
    results=[build(RAW/'ur/ur3.urdf','ur3',angles,'Universal Robots ROS2 Description contributors. BSD-3-Clause. Display pose changed.'),build(RAW/'ur/ur5.urdf','ur5',angles,'Universal Robots ROS2 Description contributors. BSD-3-Clause. Display pose changed.')]
    g1angles={'left_shoulder_roll_joint':.16,'right_shoulder_roll_joint':-.16,'left_elbow_joint':.22,'right_elbow_joint':.22}
    results.append(build(RAW/'g1/model.urdf','g1',g1angles,'Copyright 2016-2022 Unitree Robotics. BSD-3-Clause. Display pose and format changed.'))
    (BASE/'provenance/MODEL_SOURCES.conversion.json').write_text(json.dumps({'method':'Static vendor visual-mesh conversion. No dynamics, task replay or capability inference.','results':results,'inputs':SOURCES},indent=2)+'\n')
    print(json.dumps(results,indent=2))
