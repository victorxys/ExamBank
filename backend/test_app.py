import gradio_client
print(dir(gradio_client))
print(hasattr(gradio_client, 'JobError'))
if hasattr(gradio_client, 'utils'):
    print(dir(gradio_client.utils))
    print(hasattr(gradio_client.utils, 'JobError'))
if hasattr(gradio_client, 'exceptions'):
    print(dir(gradio_client.exceptions))
    print(hasattr(gradio_client.exceptions, 'JobError'))