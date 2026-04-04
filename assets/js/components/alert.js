window.alert = (txt, title = 'Information', type = 'info') => {
    const modal = document.createElement('div')
    modal.classList.add('modal', 'd-block')

    const modalDialog = document.createElement('div')
    modalDialog.classList.add('modal-dialog', 'modal-dialog-centered')

    const modalHeader = document.createElement('div')
    modalHeader.classList.add('modal-header')
    if (type === 'error') modalHeader.classList.add('bg-danger')

    const modalTitle = document.createElement('h5')
    modalTitle.classList.add('mb-0')
    modalTitle.textContent = title

    const modalContent = document.createElement('div')
    modalContent.classList.add('modal-content')

    const modalBody = document.createElement('div')
    modalBody.classList.add('modal-body')
    modalBody.innerHTML = txt

    const modalFooter = document.createElement('div')
    modalFooter.classList.add('modal-footer')

    const modalCloseButton = document.createElement('button')
    let color = ['btn-secondary', 'text-white'];
    if (type === 'error') color = ['btn-danger', 'text-white']
    modalCloseButton.classList.add('btn', ...color, 'close-modal-button')
    modalCloseButton.textContent = 'Fermer'

    modalHeader.appendChild(modalTitle)
    modalContent.appendChild(modalHeader)
    modalContent.appendChild(modalBody)
    modalFooter.appendChild(modalCloseButton)
    modalContent.appendChild(modalFooter)
    modalDialog.appendChild(modalContent)
    modal.appendChild(modalDialog)

    document.querySelector('body').appendChild(modal)

    const modalBackdrop = document.getElementById('modalBackdrop')
    if (modalBackdrop) {
        modalBackdrop.classList.add('d-block')
        modalBackdrop.classList.remove('d-none')
    }

    modalCloseButton.addEventListener('click', () => {
        modal.remove()
        if (modalBackdrop && noModalOpen()) {
            modalBackdrop.classList.add('d-none')
            modalBackdrop.classList.remove('d-block')
        }
    })
}