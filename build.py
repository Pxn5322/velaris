import os

os.makedirs('prototypes', exist_ok=True)

def write_file(filename, content):
    path = os.path.join('prototypes', filename)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'Successfully created {path}')
