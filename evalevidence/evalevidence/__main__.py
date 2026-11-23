from .contract import run
from .engine import analyze

if __name__ == '__main__':
    raise SystemExit(run(analyze, 'NO_RECORDED_REGRESSION'))
