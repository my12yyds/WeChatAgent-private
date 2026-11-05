"""Separate bounded chunks, keeping one model and streaming the final stems."""
import argparse,json,pathlib,logging,os,tempfile,wave,sys

def main():
    parser=argparse.ArgumentParser()
    for name in ('input','output','models'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--tools')
    args=parser.parse_args()
    tools=pathlib.Path(args.tools) if args.tools else pathlib.Path(__file__).resolve().parent.parent/'state'/'voice'/'tools'
    os.environ['PATH']=str(tools)+os.pathsep+os.environ.get('PATH','')
    output=pathlib.Path(args.output).resolve()
    output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='separation-',dir=output) as temp:
        work=pathlib.Path(temp)
        chunks=[]
        with wave.open(args.input,'rb') as source:
            if source.getframerate()!=44100 or source.getnchannels()!=2 or source.getsampwidth()!=2 or source.getnframes()>44100*600:
                raise RuntimeError('SONG_SEPARATOR_INPUT_INVALID')
            total=source.getnframes()
            for start in range(0,total,44100*10):
                end=min(total,start+44100*10)
                left=max(0,start-22050);right=min(total,end+22050)
                source.setpos(left);block=source.readframes(right-left)
                file=work/('part-%04d.wav'%len(chunks))
                with wave.open(str(file),'wb') as writer:
                    writer.setnchannels(2);writer.setsampwidth(2);writer.setframerate(44100);writer.writeframes(block)
                chunks.append((file,start-left,end-start))
        from audio_separator.separator import Separator
        separator=Separator(log_level=logging.ERROR,output_dir=str(work),output_format='WAV',model_file_dir=args.models)
        separator.load_model(model_filename='UVR-MDX-NET-Inst_HQ_3.onnx')
        stems={'vocals':[],'instrumental':[]}
        for index,(file,trim,frames) in enumerate(chunks):
            files=separator.separate(str(file),custom_output_names={'Vocals':'vocals-%04d'%index,'Instrumental':'instrumental-%04d'%index})
            for stem in stems:
                candidates=[work/name for name in files if stem in pathlib.Path(name).name.lower()]
                if len(candidates)!=1 or not candidates[0].is_file():raise RuntimeError('SONG_STEM_MISSING')
                stems[stem].append((candidates[0],trim,frames))
            print('MUSIC_PROGRESS:separate:%d:%d'%(index+1,len(chunks)),flush=True)
        import soundfile as sf
        for stem,files in stems.items():
            with sf.SoundFile(str(output/(stem+'.wav')),mode='w',samplerate=44100,channels=2,subtype='PCM_16') as writer:
                for file,trim,frames in files:
                    with sf.SoundFile(str(file)) as reader:
                        if reader.samplerate!=44100 or reader.channels!=2:raise RuntimeError('SONG_STEMS_INVALID')
                        reader.seek(trim);remaining=frames
                        while remaining:
                            block=reader.read(min(44100,remaining),dtype='float32',always_2d=True)
                            if not len(block):raise RuntimeError('SONG_STEMS_INVALID')
                            writer.write(block);remaining-=len(block)
    print(json.dumps({'ok':True,'stems':['vocals.wav','instrumental.wav']}))

if __name__=='__main__':
    try:main()
    except MemoryError:
        print('WECHATGIRL_MUSIC_ERROR:SONG_SEPARATOR_MEMORY_PRESSURE',file=sys.stderr);sys.exit(1)
    except Exception as error:
        code=str(error) if str(error) in {'SONG_STEM_MISSING','SONG_STEMS_INVALID','SONG_SEPARATOR_INPUT_INVALID'} else 'SONG_SEPARATOR_FAILED'
        print('WECHATGIRL_MUSIC_ERROR:'+code,file=sys.stderr);sys.exit(1)
