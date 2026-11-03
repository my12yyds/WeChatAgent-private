"""Separate one bounded song excerpt into time-aligned vocal and backing stems."""
import argparse,json,pathlib,shutil,logging,os

def main():
    parser=argparse.ArgumentParser()
    for name in ('input','output','models'):parser.add_argument('--'+name,required=True)
    args=parser.parse_args()
    tools=pathlib.Path(__file__).resolve().parent.parent/'state'/'voice'/'tools'
    os.environ['PATH']=str(tools)+os.pathsep+os.environ.get('PATH','')
    from audio_separator.separator import Separator
    output=pathlib.Path(args.output).resolve()
    separator=Separator(log_level=logging.WARNING,output_dir=str(output),output_format='WAV',model_file_dir=args.models)
    separator.load_model(model_filename='UVR-MDX-NET-Inst_HQ_3.onnx')
    files=separator.separate(args.input,custom_output_names={'Vocals':'vocals','Instrumental':'instrumental'})
    for stem in ('vocals','instrumental'):
        expected=output/(stem+'.wav')
        if not expected.is_file():
            candidates=[output/name for name in files if stem in name.lower()]
            if len(candidates)!=1:raise RuntimeError('SONG_STEM_MISSING')
            shutil.copyfile(candidates[0],expected)
    print(json.dumps({'ok':True,'stems':['vocals.wav','instrumental.wav']}))

if __name__=='__main__':main()
