window.addEventListener('DOMContentLoaded', () => {
    let fileCount = parseInt(document.getElementById('numberOfFiles').value)
    const filesBox = document.getElementById('filesBox')
    const filesList = document.getElementById('filesList')
    const uploadedFilesList = document.getElementById('uploadedFilesList')
    const form = document.getElementById('form')
    const numCreance = document.getElementById('demandesaisiedettes_numCreance')
    const selectModif = document.getElementById('demandesaisiedettes_motifId')

    // Affiche ou cache la liste des fichiers
    const showOrHideFilesBox = () => {
        let addFileInDemand = document.querySelector("input[type='radio'][name='demandesaisiedettes[ajoutPdf]']:checked").value

        if (addFileInDemand) {
            filesBox.classList.add('d-flex')
            filesBox.classList.remove('d-none')
        } else {
            if (filesList) {
                while (filesList.firstElementChild) filesList.firstElementChild.remove()
            }

            if (uploadedFilesList) {
                while (uploadedFilesList.firstElementChild) uploadedFilesList.firstElementChild.remove()
            }

            filesBox.classList.add('d-none')
            filesBox.classList.remove('d-flex')
        }
    }

    // Désactive / active des champs selon le motif
    const handleMotifChange = value => {
        let repriseRecuperationFlux = document.getElementById('demandesaisiedettes_repriseRecuperationFlux')
        let transmissionPochette = document.getElementById('demandesaisiedettes_transmissionPochette')
        let taux = document.getElementById('demandesaisiedettes_taux')
        let dateReprise = document.getElementById('demandesaisiedettes_dateReprise')
        let montantCreanceRevoir = document.getElementById('demandesaisiedettes_montantCreanceRevoir')

        if (value === "Notification") {
            numCreance.setAttribute('disabled', 'disabled')
            repriseRecuperationFlux.setAttribute('disabled', 'disabled')
            transmissionPochette.setAttribute('disabled', 'disabled')
            taux.setAttribute('disabled', 'disabled')
            dateReprise.setAttribute('disabled', 'disabled')
            montantCreanceRevoir.setAttribute('disabled', 'disabled')
        } else {
            numCreance.removeAttribute('disabled')
            repriseRecuperationFlux.removeAttribute('disabled')
            transmissionPochette.removeAttribute('disabled')
            taux.removeAttribute('disabled')
            dateReprise.removeAttribute('disabled')
            montantCreanceRevoir.removeAttribute('disabled')
        }
    }

    // Supprime un fichier
    window.removeFile = ob => {
        ob.closest('.file-box').remove();
        reindexFiles();
        fileCount = document.querySelectorAll('.file-box').length;

        const hasFileBlock = document.getElementById('hasFile');
        if (fileCount === 0 && hasFileBlock) {
            hasFileBlock.classList.add('d-none');
            hasFileBlock.classList.remove('d-block');
        }
    };

    function reindexFiles() {
        const fileBoxes = document.querySelectorAll('.file-box');
        fileBoxes.forEach((box, newIndex) => {
            box.querySelectorAll('[name], [id], label[for]').forEach(el => {
                ['name', 'id', 'for'].forEach(attr => {
                    if (el.hasAttribute(attr)) {
                        el.setAttribute(attr,
                            el.getAttribute(attr)
                                .replace(/\[files]\[\d+]/g, `[files][${newIndex}]`)
                                .replace(/_files_\d+_/g, `_files_${newIndex}_`)
                        );
                    }
                });
            });
        });
    }

    // Ajoute un fichier
    const createFile = () => {
        let removeButton = '<button class="btn btn-danger text-white" type="button" onclick="removeFile(this)">Supprimer le fichier</button>';
        let newWidget = document.getElementById('filesProto').getAttribute('data-prototype').replace(/__name__/g, fileCount);

        const htmlToInsert = '<div class="file-box in-column newFile">' + newWidget + removeButton + '</div>';
        filesList.insertAdjacentHTML('beforeend', htmlToInsert);
        fileCount++;

        if (fileCount > 0) {
            document.getElementById('hasFile').classList.add('d-block');
            document.getElementById('hasFile').classList.remove('d-none');
        }
    }

    document.getElementById('addFile').addEventListener('click', createFile)

    showOrHideFilesBox()
    handleMotifChange(selectModif.options[selectModif.selectedIndex].innerHTML)

    document.querySelectorAll("input[name='demandesaisiedettes[ajoutPdf]']").forEach(el => {
        el.addEventListener('click', () => {
            showOrHideFilesBox()
        })
    })

    document.getElementById('demandesaisiedettes_motifId').addEventListener('change', () => {
        handleMotifChange(selectModif.options[selectModif.selectedIndex].innerHTML)
    })

    form.addEventListener('submit', event => {
        event.preventDefault()
        let addFileInDemand = document.querySelector("input[type='radio'][name='demandesaisiedettes[ajoutPdf]']:checked").value

        if (isNaN(numCreance.value)) {
            alert('Numéro de créance saisi incorrect, il doit être de type numérique.')
            return
        }

        if (addFileInDemand) {
            if (fileCount === 0) {
                alert('Merci d\'ajouter un fichier ou de cocher "Non".')
                return
            }

            let stopped = 0
            let allowedExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv']
            filesList.querySelectorAll('.newFile').forEach(fileBox => {
                let inputs = fileBox.querySelectorAll('input')
                let hasEmpty = false
                let fileInput = null

                inputs.forEach(input => {
                    if (input.type === 'file') {
                        fileInput = input
                    }

                    if (!input.value) {
                        hasEmpty = true
                    }
                })

                if (hasEmpty) {
                    alert('Vous avez ajouté un fichier, mais vous n\'avez pas complété toutes les informations.')
                    stopped = 1
                    return
                }

                if (fileInput && fileInput.files.length > 0) {
                    let fileName = fileInput.files[0].name
                    let extension = fileName.split('.').pop().toLowerCase()

                    if (!allowedExtensions.includes(extension)) {
                        alert('Extension de fichier non autorisée : ' + extension + '. Formats acceptés : PDF, DOC, DOCX, XLS, XLSX, CSV.')
                        stopped = 1
                        return
                    }
                }
            })

            if (stopped === 1) return false
        }

        form.submit()
    })
})