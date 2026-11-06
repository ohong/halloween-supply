"""One-off check that both ONNX models run in cv2.dnn and agree with onnxruntime.

Offline only: uv run --with onnxruntime python scripts/probe_models.py <image>
"""
import sys, time
import cv2, numpy as np

LABELS = ["Background", "Hat", "Hair", "Sunglasses", "Upper-clothes", "Skirt", "Pants", "Dress", "Belt",
          "Left-shoe", "Right-shoe", "Face", "Left-leg", "Right-leg", "Left-arm", "Right-arm", "Bag", "Scarf"]

img = cv2.imread(sys.argv[1])
h, w = img.shape[:2]
rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

def seg_blob(rgb):
    x = cv2.resize(rgb, (512, 512), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    return x.transpose(2, 0, 1)[None].astype(np.float32)

def clip_blob(rgb):
    s = 224 / min(rgb.shape[:2])
    r = cv2.resize(rgb, (round(rgb.shape[1] * s), round(rgb.shape[0] * s)), interpolation=cv2.INTER_CUBIC)
    y, x = (r.shape[0] - 224) // 2, (r.shape[1] - 224) // 2
    r = r[y:y + 224, x:x + 224].astype(np.float32) / 255.0
    r = (r - [0.48145466, 0.4578275, 0.40821073]) / [0.26862954, 0.26130258, 0.27577711]
    return r.transpose(2, 0, 1)[None].astype(np.float32)

def run_cv(path, blob, engine):
    net = cv2.dnn.readNet(path, engine=engine) if engine is not None else cv2.dnn.readNet(path)
    net.setInput(blob)
    net.forward()  # warm
    t = time.time(); out = net.forward(); return out, time.time() - t

for name, blob in [("segformer_b2_clothes.onnx", seg_blob(rgb)), ("clip_vit_b32_vision.onnx", clip_blob(rgb))]:
    path = f"models/{name}"
    ref = None
    try:
        import onnxruntime as ort
        s = ort.InferenceSession(path)
        ref = s.run(None, {s.get_inputs()[0].name: blob})[0]
    except ImportError:
        pass
    for eng_name in ["ENGINE_NEW", "ENGINE_CLASSIC"]:
        try:
            out, dt = run_cv(path, blob, getattr(cv2.dnn, eng_name))
        except Exception as e:
            print(name, eng_name, "FAILED:", str(e)[:300]); continue
        msg = f"{name} {eng_name} shape={out.shape} {dt*1000:.0f}ms"
        if ref is not None:
            msg += f" max_abs_diff={np.abs(out - ref).max():.2e}"
            if out.ndim == 4:
                msg += f" argmax_agree={(out.argmax(1) == ref.argmax(1)).mean():.4f}"
            else:
                a, b = out.ravel(), ref.ravel()
                msg += f" cos={a @ b / np.linalg.norm(a) / np.linalg.norm(b):.6f}"
        print(msg)
        if out.ndim == 4 and eng_name == "ENGINE_NEW":
            logits = out[0]
            up = np.stack([cv2.resize(c, (w, h), interpolation=cv2.INTER_LINEAR) for c in logits])
            lab = up.argmax(0).astype(np.uint8)
            rng = np.random.default_rng(3)
            pal = rng.integers(40, 255, (18, 3), dtype=np.uint8); pal[0] = 0
            over = cv2.addWeighted(img, 0.5, pal[lab], 0.5, 0)
            for i in range(1, 18):
                m = (lab == i).astype(np.uint8)
                if m.sum() < 0.002 * h * w: continue
                x, y, bw, bh = cv2.boundingRect(m)
                cv2.rectangle(over, (x, y), (x + bw, y + bh), pal[i].tolist(), 3)
                cv2.putText(over, f"{LABELS[i]} {m.mean()*100:.1f}%", (x + 4, y + 28), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
                print("  ", LABELS[i], f"{m.mean()*100:.1f}%", (x, y, bw, bh))
            cv2.imwrite("debug/probe_overlay.png", over)
        if out.ndim == 2:
            print("   norm", np.linalg.norm(out))
