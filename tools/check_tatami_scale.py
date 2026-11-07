#!/usr/bin/env python3
"""Measure rendered warp pitch against the grid step from browser PNGs alone."""
import argparse,json,statistics,sys
from pathlib import Path
sys.dont_write_bytecode=True;sys.path.insert(0,str(Path(__file__).parent))
from check_render_pixels import png

TARGET=14/22


def column_profile(image,x0,x1,y0,y1):
    # The median across rows ignores stones and keeps full-height grid lines/cords.
    width,height,channels,rows=image
    return [statistics.median(sum(rows[y][x*channels:x*channels+3]) for y in range(y0,y1,3))/3 for x in range(x0,x1)]


def autocorrelation(profile,limit):
    window=31;half=window//2
    flat=[profile[i]-sum(profile[max(0,i-half):i+half+1])/len(profile[max(0,i-half):i+half+1]) for i in range(len(profile))]
    def at(lag):
        pairs=len(flat)-lag
        return sum(flat[i]*flat[i+lag] for i in range(pairs))/pairs
    zero=at(0);return [at(lag)/zero for lag in range(limit)]


def peak(values,lag):
    a,b,c=values[lag-1:lag+2];return lag+.5*(a-c)/(a-2*b+c)


def pitch(profile,low,high):
    """Fundamental period, refined over as many repeats as the profile allows."""
    limit=min(len(profile)*2//3,int(high)*8+2);values=autocorrelation(profile,limit)
    peaks=[lag for lag in range(max(2,int(low)),int(high)+1) if values[lag]>=values[lag-1] and values[lag]>values[lag+1]]
    assert peaks,'No periodic structure found'
    best=max(values[lag] for lag in peaks);first=next(lag for lag in peaks if values[lag]>=.6*best)
    period=peak(values,first);repeats=1
    for k in range(2,9):
        lag=round(period*k)
        if lag+2>=limit:break
        lag=max(range(lag-2,lag+3),key=values.__getitem__)
        if values[lag]<.35*values[first]:break
        period=peak(values,lag)/k;repeats=k
    return period,repeats,values[first]


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('directory',type=Path)
    parser.add_argument('--tolerance',type=float,default=.015,help='Allowed relative ratio error')
    args=parser.parse_args()
    results=[];failed=False
    for item in json.loads((args.directory/'surfaces.json').read_text()):
        if 'natural' not in item['name'] and 'tatami' not in item['name']:continue
        image=png(args.directory/(item['name']+'.png'));width,height,*_=image;scale=item.get('scale',1)
        r={k:round(v*scale) for k,v in item['rect'].items() if isinstance(v,(int,float))}
        bar=min(height,round(item.get('bar',item['rect']['bottom'])*scale))
        inset=round(.25*(r['right']-r['left'])/19);y0,y1=r['top']+inset*3,min(r['bottom'],bar)-inset
        grid,grid_repeats,_=pitch(column_profile(image,r['left']+inset*3,r['right']-inset,y0,y1),12*scale,(r['right']-r['left'])/9)
        sides=[]
        for x0,x1 in ((4,r['left']-8*scale),(r['right']+8*scale,width-4)):
            if x1-x0>=grid*2.5:
                period,repeats,strength=pitch(column_profile(image,x0,x1,0,bar),grid*.3,grid*1.7)
                sides.append({'pitch':round(period,2),'repeats':repeats,'strength':round(strength,2)})
        assert sides,f"{item['name']}: no mat region wide enough to measure"
        warp=sum(s['pitch'] for s in sides)/len(sides);ratio=warp/grid;ok=abs(ratio/TARGET-1)<=args.tolerance;failed|=not ok
        results.append({'name':item['name'],'grid':round(grid/scale,2),'grid_repeats':grid_repeats,'warp':round(warp/scale,2),'sides':sides,'ratio':round(ratio,4),'mm_at_22':round(ratio*22,2),'pass':ok})
    assert results,'No tatami screenshots found'
    print(json.dumps(results,indent=1));sys.exit(1 if failed else 0)


if __name__=='__main__':main()
