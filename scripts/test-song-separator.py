"""No model imports: guard ORT memory policy and private error boundaries."""
import pathlib, runpy, types, unittest

worker = runpy.run_path(str(pathlib.Path(__file__).with_name('separate-song.py')))

class SeparatorPolicyTests(unittest.TestCase):
    def runtime(self):
        calls = []
        def session(model, options, **kwargs):
            calls.append((model, options, kwargs))
            return object()
        return types.SimpleNamespace(InferenceSession=session, SessionOptions=types.SimpleNamespace), calls

    def test_real_library_call_keeps_provider_and_logging_without_retaining_cpu_arenas(self):
        runtime, calls = self.runtime()
        original = runtime.InferenceSession
        options = types.SimpleNamespace(log_severity_level=3)
        def load_model(**kwargs):
            runtime.InferenceSession(kwargs['model_filename'], sess_options=options, providers=['CPUExecutionProvider'])
        worker['load_separator_model'](types.SimpleNamespace(load_model=load_model), runtime)
        self.assertIs(runtime.InferenceSession, original)
        self.assertIs(calls[0][1], options)
        self.assertEqual(calls[0][2]['providers'], ['CPUExecutionProvider'])
        self.assertFalse(options.enable_cpu_mem_arena)
        self.assertFalse(options.enable_mem_pattern)
        self.assertEqual(options.log_severity_level, 3)
        self.assertEqual(options.inter_op_num_threads, 1)
        self.assertTrue(1 <= options.intra_op_num_threads <= 4)

    def test_failed_model_load_restores_the_constructor(self):
        runtime, _ = self.runtime()
        original = runtime.InferenceSession
        def failed(**kwargs):
            runtime.InferenceSession('fictional-model')
            raise RuntimeError('fictional model failure')
        with self.assertRaises(RuntimeError):
            worker['load_separator_model'](types.SimpleNamespace(load_model=failed), runtime)
        self.assertIs(runtime.InferenceSession, original)

    def test_onnx_and_torch_allocation_failures_are_memory_pressure_without_private_text(self):
        for error in (MemoryError(), RuntimeError('[ONNXRuntimeError] BFCArena Failed to allocate memory for requested buffer of size 150994944'),
                      RuntimeError('CUDA out of memory. private/path'), RuntimeError('std::bad_alloc'), OSError(12, 'private/path')):
            self.assertEqual(worker['error_code'](error), 'SONG_SEPARATOR_MEMORY_PRESSURE')
        self.assertEqual(worker['error_code'](RuntimeError('private path or provider diagnostics')), 'SONG_SEPARATOR_FAILED')
        self.assertEqual(worker['error_code'](RuntimeError('SONG_STEM_MISSING')), 'SONG_STEM_MISSING')

if __name__ == '__main__':
    unittest.main()
