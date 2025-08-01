import os
import sys

# 直接导入重置函数
from manager_module import reset_all_usage

# 将项目根目录添加到Python的搜索路径中
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)


def main():
    reset_all_usage()


if __name__ == "__main__":
    main()
