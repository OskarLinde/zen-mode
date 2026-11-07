#!/usr/bin/env python3
"""Check painted mat pixels from check_chrome --layout-only, using stdlib PNG decoding."""
import argparse,json,math,struct,zlib
from pathlib import Path


def png(path):
    data=path.read_bytes();assert data[:8]==b'\x89PNG\r\n\x1a\n'
    offset=8;compressed=b''
    while offset<len(data):
        length,kind=struct.unpack('>I4s',data[offset:offset+8]);chunk=data[offset+8:offset+8+length];offset+=length+12
        if kind==b'IHDR':width,height,depth,color,_,_,interlace=struct.unpack('>IIBBBBB',chunk)
        if kind==b'IDAT':compressed+=chunk
    assert depth==8 and color in (2,6) and interlace==0,'Expected ordinary RGB/RGBA browser PNG'
    channels=3 if color==2 else 4;stride=width*channels;raw=zlib.decompress(compressed);rows=[];previous=bytes(stride)
    for y in range(height):
        start=y*(stride+1);method=raw[start];row=bytearray(raw[start+1:start+stride+1])
        for i in range(stride):
            a=row[i-channels] if i>=channels else 0;b=previous[i];c=previous[i-channels] if i>=channels else 0
            if method==1:value=a
            elif method==2:value=b
            elif method==3:value=(a+b)//2
            elif method==4:
                p=a+b-c;pa,pb,pc=abs(p-a),abs(p-b),abs(p-c);value=a if pa<=pb and pa<=pc else b if pb<=pc else c
            else:assert method==0;value=0
            row[i]=(row[i]+value)&255
        rows.append(row);previous=row
    return width,height,channels,rows


def sample(image,rect):
    width,height,channels,rows=image;x0,y0,x1,y1=map(int,rect)
    assert 0<=x0<x1<=width and 0<=y0<y1<=height
    return [sum(rows[y][x*channels:x*channels+3])/3 for y in range(y0,y1) for x in range(x0,x1)]


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('directory',type=Path);args=parser.parse_args()
    surfaces={item['name']:item['rect'] for item in json.loads((args.directory/'surfaces.json').read_text())}
    images={name:png(args.directory/(name+'.png')) for name in surfaces};metrics=[]
    for name,image in images.items():
        if 'natural' not in name and name!='wide-full-site-auto':continue
        width,height,*_=image;r=surfaces[name];y=min(200,int(r['bottom'])-80)
        patches=[]
        if r['left']>=100:patches += [(12,y,76,y+64),(int(r['left'])-88,y,int(r['left'])-24,y+64)]
        if width-r['right']>=100:patches += [(width-76,y,width-12,y+64),(int(r['right'])+24,y,int(r['right'])+88,y+64)]
        assert patches,'Full-board fixture must expose mat for a meaningful pixel check'
        for rect in patches:
            pixels=sample(image,rect);mean=sum(pixels)/len(pixels);sigma=math.sqrt(sum((v-mean)**2 for v in pixels)/len(pixels))
            assert sigma>2,f'{name}: mat is flat/unpainted at {rect}, deviation {sigma}'
            metrics.append({'name':name,'patch':rect,'deviation':round(sigma,2)})
    # Same theme, geometry and decoded native texture; only the mat selection differs.
    a=images['wide-full-site-natural'];b=images['wide-full-site-woven'];r=surfaces['wide-full-site-natural']
    rect=(12,200,76,264) if r['left']>=100 else (a[0]-76,200,a[0]-12,264)
    difference=sum(abs(x-y) for x,y in zip(sample(a,rect),sample(b,rect)))/4096
    assert difference>2,'Natural and Woven must actually paint different pixels'
    print(json.dumps({'painted_mat_patches':metrics,'natural_woven_difference':round(difference,2)},indent=2))


if __name__=='__main__':main()
