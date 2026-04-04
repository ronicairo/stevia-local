window.confirm = (txt, title = 'Confirmation') => {
    return new Promise((resolve) => {
        const modal = document.createElement('div')
        modal.classList.add('modal', 'd-block')

        const modalDialog = document.createElement('div')
        modalDialog.classList.add('modal-dialog', 'modal-dialog-centered')

        const modalContent = document.createElement('div')
        modalContent.classList.add('modal-content')

        const modalHeader = document.createElement('div')
        modalHeader.classList.add('modal-header')

        const modalTitle = document.createElement('h5')
        modalTitle.classList.add('mb-0')
        modalTitle.textContent = title

        modalHeader.appendChild(modalTitle)
        modalContent.appendChild(modalHeader)

        const modalBody = document.createElement('div')
        modalBody.classList.add('modal-body')
        modalBody.innerHTML = txt
        modalContent.appendChild(modalBody)

        const modalFooter = document.createElement('div')
        modalFooter.classList.add('modal-footer')

        const btnOk = document.createElement('button')
        btnOk.classList.add('btn', 'btn-secondary', 'text-white', 'confirm-modal-button')
        btnOk.textContent = 'OUI'

        const btnCancel = document.createElement('button')
        btnCancel.classList.add('btn', 'btn-danger', 'text-white', 'close-modal-button')
        btnCancel.textContent = 'NON'

        modalFooter.appendChild(btnOk)
        modalFooter.appendChild(btnCancel)
        modalContent.appendChild(modalFooter)

        modalDialog.appendChild(modalContent)
        modal.appendChild(modalDialog)
        document.body.appendChild(modal)

        const modalBackdrop = document.getElementById('modalBackdrop')
        if (modalBackdrop) {
            modalBackdrop.classList.add('d-block')
            modalBackdrop.classList.remove('d-none')
        }

        btnOk.addEventListener('click', () => {
            modal.remove();
            if (modalBackdrop && noModalOpen()) {
                modalBackdrop.classList.add('d-none');
                modalBackdrop.classList.remove('d-block');
            }
            resolve(true)
        })

        btnCancel.addEventListener('click', () => {
            modal.remove();
            if (modalBackdrop && noModalOpen()) {
                modalBackdrop.classList.add('d-none');
                modalBackdrop.classList.remove('d-block');
            }
            resolve(false)
        })
    })
}