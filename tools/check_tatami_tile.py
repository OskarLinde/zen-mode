#!/usr/bin/env python3
"""Check that a tatami tile wraps: no line, tonal step or cord-phase jump."""
import argparse,cmath,math,statistics,sys
from pathlib import Path
sys.dont_write_bytecode=True;sys.path.insert(0,str(Path(__file__).parent))
from check_render_pixels import png

PITCH=63.88;CORDS=17


def luminance(path):
    width,height,channels,rows=png(path)
    return width,height,[[sum(row[x*channels:x*channels+3])/3 for x in range(width)] for row in rows]


def row_steps(lines):
    """Mean difference of each adjacent pair; the last pair is the wrap."""
    return [sum(abs(a-b) for a,b in zip(lines[i],lines[(i+1)%len(lines)]))/len(lines[i]) for i in range(len(lines))]


def phase(profile,start,span,period):
    value=sum(profile[(start+i)%len(profile)]*cmath.exp(-2j*math.pi*(start+i)/period) for i in range(span))
    return cmath.phase(value)*period/(2*math.pi)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('tile',type=Path);args=parser.parse_args()
    width,height,lines=luminance(args.tile);columns=[list(c) for c in zip(*lines)]
    report={};failed=[]
    for name,data in (('rows',lines),('columns',columns)):
        steps=row_steps(data);wrap,inner=steps[-1],sorted(steps[:-1]);rank=sum(s<wrap for s in inner)/len(inner)
        report[name+'_wrap']=round(wrap,2);report[name+'_interior_p98']=round(inner[len(inner)*98//100],2)
        if rank>.98:failed.append(name+' wrap exceeds the interior line differences')
    # With an exact whole number of cords, the phase either side of the wrap must agree.
    period=width/CORDS;profile=[statistics.fmean(c) for c in columns]
    drift=(phase(profile,width-256,256,period)-phase(profile,0,256,period)+period/2)%period-period/2
    report['cord_period']=round(period,3);report['cord_phase_jump_px']=round(drift,2)
    if abs(period/PITCH-1)>.002:failed.append('cord period differs from the CSS pitch')
    if abs(drift)>4:failed.append('cord phase jumps across the wrap')
    print(report)
    if failed:sys.exit('; '.join(failed))


if __name__=='__main__':main()
